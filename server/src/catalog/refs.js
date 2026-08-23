export async function upsertProductRef(connection, product) {
  const [result] = await connection.execute(
    `INSERT INTO catalog_product_refs
      (external_id, last_known_name, last_known_image_url, last_known_brand,
       last_verified_price, currency, is_available, stock_quantity, last_verified_at)
     VALUES (?, ?, ?, ?, ?, 'MAD', ?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id), last_known_name = VALUES(last_known_name),
       last_known_image_url = VALUES(last_known_image_url), last_known_brand = VALUES(last_known_brand),
       last_verified_price = VALUES(last_verified_price), is_available = VALUES(is_available),
       stock_quantity = VALUES(stock_quantity), last_verified_at = UTC_TIMESTAMP(3)`,
    [product.id, product.name, product.image_url || null, product.brand_name || null,
      product.price, product.is_available, product.stock_quantity]
  );
  return result.insertId;
}
