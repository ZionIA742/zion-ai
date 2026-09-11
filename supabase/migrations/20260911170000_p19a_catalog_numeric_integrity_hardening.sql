alter table public.pools
  add constraint pools_width_m_positive_check check (width_m > 0),
  add constraint pools_length_m_positive_check check (length_m > 0),
  add constraint pools_depth_m_positive_check check (depth_m > 0),
  add constraint pools_max_capacity_l_positive_check check (max_capacity_l > 0),
  add constraint pools_price_nonnegative_check check (price is null or price >= 0),
  add constraint pools_stock_quantity_nonnegative_check check (stock_quantity is null or stock_quantity >= 0);

alter table public.store_catalog_items
  add constraint store_catalog_items_stock_quantity_nonnegative_check
  check (stock_quantity is null or stock_quantity >= 0);
