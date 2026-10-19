export function getWhatsappProcessAllHttpStatus(totalStores: number, storeErrors: number) {
  if (storeErrors <= 0) return 200;
  if (totalStores > 0 && storeErrors >= totalStores) return 500;
  return 207;
}
