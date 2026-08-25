import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { conflict, forbidden, notFound } from '../http/errors.js';
import { clearSessionCookie } from '../security/cookies.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { displayNameSchema, emailSchema, optionalPhoneSchema, passwordSchema, publicIdSchema, phoneSchema } from '../validation/common.js';
import { requireAuth } from '../auth/session.js';
import { isLocalDemoEmail } from '../auth/local-demo.js';

const profileSchema = z.object({
  displayName: displayNameSchema.optional(),
  phone: optionalPhoneSchema.optional(),
  email: emailSchema.optional(),
  currentPassword: z.string().min(1).max(128).optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'currentPassword'), {
  message: 'Provide at least one profile field.'
});

const preferencesSchema = z.object({
  language: z.enum(['en', 'fr']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  defaultPayment: z.enum(['cod', 'card', 'wafacash', 'cashplus']).optional(),
  orderNotifications: z.boolean().optional(),
  lowStockNotifications: z.boolean().optional(),
  personalizationEnabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one preference.' });

const addressSchema = z.object({
  label: z.string().trim().min(1).max(50),
  recipientName: displayNameSchema,
  phone: phoneSchema,
  email: z.union([emailSchema, z.literal(''), z.null()]).transform((value) => value || null).optional(),
  addressLine1: z.string().trim().min(4).max(255),
  addressLine2: z.union([z.string().trim().max(255), z.literal(''), z.null()]).transform((value) => value || null).optional(),
  district: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  postalCode: z.union([z.string().trim().max(20), z.literal(''), z.null()]).transform((value) => value || null).optional(),
  deliveryInstructions: z.union([z.string().trim().max(500), z.literal(''), z.null()]).transform((value) => value || null).optional(),
  isDefault: z.boolean().default(false)
}).strict();

const addressPatchSchema = addressSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one address field.'
});

const closeAccountSchema = z.object({
  password: z.string().min(1).max(128),
  action: z.enum(['deactivate', 'delete']).default('deactivate')
}).strict();

async function inTransaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function addressDto(row) {
  return {
    id: row.public_id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone_e164,
    email: row.email,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    district: row.district,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country_code,
    deliveryInstructions: row.delivery_instructions,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const addressSelect = `SELECT id, public_id, label, recipient_name, phone_e164, email,
  address_line1, address_line2, district, city, postal_code, country_code,
  delivery_instructions, is_default, created_at, updated_at
  FROM delivery_addresses`;

export function createAccountRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ user: req.auth.user });
  });

  router.patch('/', async (req, res) => {
    const input = profileSchema.parse(req.body);
    if (req.auth.accountKind === 'local_demo' && input.email !== undefined) {
      throw forbidden('DEMO_ACCOUNT_RESTRICTED', 'This system-managed account email cannot be changed.');
    }
    if (input.email !== undefined && isLocalDemoEmail(input.email)) {
      throw conflict('EMAIL_RESERVED', 'This email domain is reserved for system-managed accounts.');
    }
    const [rows] = await req.app.locals.db.execute(
      'SELECT email, password_hash FROM users WHERE id = ? AND status = \'active\' LIMIT 1',
      [req.auth.userId]
    );
    const current = rows[0];
    if (!current) throw notFound('ACCOUNT_NOT_FOUND', 'The account was not found.');
    const changingEmail = input.email && input.email !== current.email;
    if (changingEmail && (!input.currentPassword || !(await verifyPassword(current.password_hash, input.currentPassword)))) {
      throw conflict('PASSWORD_REQUIRED', 'The current password is required to change email.');
    }

    const fields = [];
    const values = [];
    if (input.displayName !== undefined) { fields.push('display_name = ?'); values.push(input.displayName); }
    if (input.phone !== undefined) { fields.push('phone_e164 = ?'); values.push(input.phone); }
    if (changingEmail) {
      fields.push('email = ?', 'email_normalized = ?', 'email_verified_at = NULL');
      values.push(input.email, input.email);
    }
    if (fields.length) {
      try {
        await req.app.locals.db.execute(
          `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
          [...values, req.auth.userId]
        );
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') throw conflict('EMAIL_ALREADY_REGISTERED', 'That email address is already in use.');
        throw error;
      }
    }
    const [updated] = await req.app.locals.db.execute(
      `SELECT public_id, email, display_name, phone_e164, email_verified_at
         FROM users WHERE id = ? LIMIT 1`,
      [req.auth.userId]
    );
    const user = updated[0];
    res.json({
      user: {
        id: user.public_id,
        email: user.email,
        displayName: user.display_name,
        phone: user.phone_e164,
        emailVerified: Boolean(user.email_verified_at)
      }
    });
  });

  router.delete('/', async (req, res) => {
    const input = closeAccountSchema.parse(req.body);
    if (req.auth.accountKind === 'local_demo') {
      throw forbidden('DEMO_ACCOUNT_RESTRICTED', 'This system-managed account cannot be closed or deleted.');
    }
    const [rows] = await req.app.locals.db.execute(
      'SELECT password_hash FROM users WHERE id = ? AND status = \'active\' LIMIT 1',
      [req.auth.userId]
    );
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, input.password))) {
      throw conflict('PASSWORD_INVALID', 'The password is incorrect.');
    }
    await inTransaction(req.app.locals.db, async (connection) => {
      if (input.action === 'delete') {
        const anonymizedEmail = `deleted-${randomUUID()}@deleted.invalid`;
        await connection.execute(
          `UPDATE users
              SET status = 'deactivated', email = ?, email_normalized = ?,
                  display_name = 'Deleted customer', phone_e164 = NULL,
                  email_verified_at = NULL, deactivated_at = UTC_TIMESTAMP(3),
                  password_hash = ?
            WHERE id = ?`,
          [anonymizedEmail, anonymizedEmail, await hashPassword(randomUUID()), req.auth.userId]
        );
        await connection.execute('UPDATE delivery_addresses SET deleted_at = UTC_TIMESTAMP(3), is_default = 0, default_user_id = NULL WHERE user_id = ? AND deleted_at IS NULL', [req.auth.userId]);
        await connection.execute('DELETE FROM recently_viewed_products WHERE user_id = ?', [req.auth.userId]);
        await connection.execute('DELETE FROM search_history WHERE user_id = ?', [req.auth.userId]);
        await connection.execute('DELETE FROM recommendation_snapshots WHERE user_id = ?', [req.auth.userId]);
        await connection.execute('DELETE FROM notifications WHERE user_id = ?', [req.auth.userId]);
        await connection.execute('DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ?', [req.auth.userId]);
        await connection.execute('DELETE wi FROM wishlist_items wi JOIN wishlists w ON w.id = wi.wishlist_id WHERE w.user_id = ?', [req.auth.userId]);
      } else {
        await connection.execute(
          `UPDATE users SET status = 'deactivated', deactivated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
          [req.auth.userId]
        );
      }
      await connection.execute(
        'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)) WHERE user_id = ?',
        [req.auth.userId]
      );
    });
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/preferences', async (req, res) => {
    const [rows] = await req.app.locals.db.execute(
      `SELECT language, theme, default_payment, order_notifications,
              low_stock_notifications, personalization_enabled, updated_at
         FROM user_preferences WHERE user_id = ? LIMIT 1`,
      [req.auth.userId]
    );
    const row = rows[0];
    res.json({
      preferences: {
        language: row.language,
        theme: row.theme,
        defaultPayment: row.default_payment,
        orderNotifications: Boolean(row.order_notifications),
        lowStockNotifications: Boolean(row.low_stock_notifications),
        personalizationEnabled: Boolean(row.personalization_enabled),
        updatedAt: row.updated_at
      }
    });
  });

  router.patch('/preferences', async (req, res) => {
    const input = preferencesSchema.parse(req.body);
    const mapping = {
      language: 'language',
      theme: 'theme',
      defaultPayment: 'default_payment',
      orderNotifications: 'order_notifications',
      lowStockNotifications: 'low_stock_notifications',
      personalizationEnabled: 'personalization_enabled'
    };
    const entries = Object.entries(input);
    await req.app.locals.db.execute(
      `UPDATE user_preferences SET ${entries.map(([key]) => `${mapping[key]} = ?`).join(', ')} WHERE user_id = ?`,
      [...entries.map(([, value]) => value), req.auth.userId]
    );
    const [rows] = await req.app.locals.db.execute(
      `SELECT language, theme, default_payment, order_notifications,
              low_stock_notifications, personalization_enabled, updated_at
         FROM user_preferences WHERE user_id = ? LIMIT 1`,
      [req.auth.userId]
    );
    const row = rows[0];
    res.json({ preferences: {
      language: row.language,
      theme: row.theme,
      defaultPayment: row.default_payment,
      orderNotifications: Boolean(row.order_notifications),
      lowStockNotifications: Boolean(row.low_stock_notifications),
      personalizationEnabled: Boolean(row.personalization_enabled),
      updatedAt: row.updated_at
    } });
  });

  router.get('/addresses', async (req, res) => {
    const [rows] = await req.app.locals.db.execute(
      `${addressSelect} WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, updated_at DESC`,
      [req.auth.userId]
    );
    res.json({ addresses: rows.map(addressDto) });
  });

  router.post('/addresses', async (req, res) => {
    const input = addressSchema.parse(req.body);
    const candidatePublicId = randomUUID();
    const result = await inTransaction(req.app.locals.db, async (connection) => {
      // Serialize address creation per customer so an ambiguous client retry
      // can resolve to the identical committed address instead of duplicating it.
      await connection.execute('SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.auth.userId]);
      const [countRows] = await connection.execute(
        'SELECT COUNT(*) AS total FROM delivery_addresses WHERE user_id = ? AND deleted_at IS NULL FOR UPDATE',
        [req.auth.userId]
      );
      const makeDefault = input.isDefault || Number(countRows[0].total) === 0;
      const [existingRows] = await connection.execute(
        `SELECT public_id FROM delivery_addresses
          WHERE user_id = ? AND deleted_at IS NULL
            AND label = ? AND recipient_name = ? AND phone_e164 = ?
            AND email <=> ? AND address_line1 = ? AND address_line2 <=> ?
            AND district = ? AND city = ? AND postal_code <=> ?
            AND delivery_instructions <=> ?
          LIMIT 1 FOR UPDATE`,
        [req.auth.userId, input.label, input.recipientName, input.phone, input.email ?? null,
          input.addressLine1, input.addressLine2 ?? null, input.district, input.city,
          input.postalCode ?? null, input.deliveryInstructions ?? null]
      );
      if (existingRows[0]) {
        return { publicId: existingRows[0].public_id, replayed: true };
      }
      if (makeDefault) {
        await connection.execute('UPDATE delivery_addresses SET is_default = 0, default_user_id = NULL WHERE user_id = ? AND deleted_at IS NULL', [req.auth.userId]);
      }
      await connection.execute(
        `INSERT INTO delivery_addresses
          (public_id, user_id, label, recipient_name, phone_e164, email, address_line1,
           address_line2, district, city, postal_code, country_code, delivery_instructions, is_default, default_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MA', ?, ?, ?)`,
        [candidatePublicId, req.auth.userId, input.label, input.recipientName, input.phone, input.email ?? null,
          input.addressLine1, input.addressLine2 ?? null, input.district, input.city, input.postalCode ?? null,
          input.deliveryInstructions ?? null, makeDefault, makeDefault ? req.auth.userId : null]
      );
      return { publicId: candidatePublicId, replayed: false };
    });
    const [rows] = await req.app.locals.db.execute(
      `${addressSelect} WHERE public_id = ? AND user_id = ? LIMIT 1`,
      [result.publicId, req.auth.userId]
    );
    res.status(result.replayed ? 200 : 201).json({ address: addressDto(rows[0]), replayed: result.replayed });
  });

  router.patch('/addresses/:addressId', async (req, res) => {
    const addressId = publicIdSchema.parse(req.params.addressId);
    const input = addressPatchSchema.parse(req.body);
    await inTransaction(req.app.locals.db, async (connection) => {
      const [rows] = await connection.execute(
        `${addressSelect} WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [addressId, req.auth.userId]
      );
      if (!rows[0]) throw notFound('ADDRESS_NOT_FOUND', 'The address was not found.');
      const current = addressDto(rows[0]);
      const merged = { ...current, ...input };
      if (merged.isDefault && !current.isDefault) {
        await connection.execute('UPDATE delivery_addresses SET is_default = 0, default_user_id = NULL WHERE user_id = ? AND deleted_at IS NULL', [req.auth.userId]);
      }
      await connection.execute(
        `UPDATE delivery_addresses SET label = ?, recipient_name = ?, phone_e164 = ?, email = ?,
          address_line1 = ?, address_line2 = ?, district = ?, city = ?, postal_code = ?,
          delivery_instructions = ?, is_default = ?, default_user_id = ?
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
        [merged.label, merged.recipientName, merged.phone, merged.email, merged.addressLine1,
          merged.addressLine2, merged.district, merged.city, merged.postalCode,
          merged.deliveryInstructions, merged.isDefault, merged.isDefault ? req.auth.userId : null, addressId, req.auth.userId]
      );
    });
    const [rows] = await req.app.locals.db.execute(
      `${addressSelect} WHERE public_id = ? AND user_id = ? LIMIT 1`,
      [addressId, req.auth.userId]
    );
    res.json({ address: addressDto(rows[0]) });
  });

  router.delete('/addresses/:addressId', async (req, res) => {
    const addressId = publicIdSchema.parse(req.params.addressId);
    await inTransaction(req.app.locals.db, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id, is_default FROM delivery_addresses WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [addressId, req.auth.userId]
      );
      if (!rows[0]) throw notFound('ADDRESS_NOT_FOUND', 'The address was not found.');
      await connection.execute(
        'UPDATE delivery_addresses SET deleted_at = UTC_TIMESTAMP(3), is_default = 0, default_user_id = NULL WHERE id = ?',
        [rows[0].id]
      );
      if (rows[0].is_default) {
        const [nextRows] = await connection.execute(
          'SELECT id FROM delivery_addresses WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1 FOR UPDATE',
          [req.auth.userId]
        );
        if (nextRows[0]) await connection.execute('UPDATE delivery_addresses SET is_default = 1, default_user_id = user_id WHERE id = ?', [nextRows[0].id]);
      }
    });
    res.status(204).end();
  });

  router.put('/addresses/:addressId/default', async (req, res) => {
    const addressId = publicIdSchema.parse(req.params.addressId);
    await inTransaction(req.app.locals.db, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id FROM delivery_addresses WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [addressId, req.auth.userId]
      );
      if (!rows[0]) throw notFound('ADDRESS_NOT_FOUND', 'The address was not found.');
      await connection.execute('UPDATE delivery_addresses SET is_default = 0, default_user_id = NULL WHERE user_id = ? AND deleted_at IS NULL', [req.auth.userId]);
      await connection.execute('UPDATE delivery_addresses SET is_default = 1, default_user_id = user_id WHERE id = ?', [rows[0].id]);
    });
    res.status(204).end();
  });

  return router;
}
