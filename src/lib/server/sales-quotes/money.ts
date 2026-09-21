import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";

type ItemMoneyErrorCodes = {
  quantity: string;
  unitPriceCents: string;
  discountCents: string;
};

type QuoteItemMoneyInput = {
  quantity: unknown;
  unitPriceCents: unknown;
  discountCents: unknown;
  itemIndex: number;
  errorCodes: ItemMoneyErrorCodes;
};

export type NormalizedQuoteItemMoney = {
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
};

export type QuoteMoneyTotals = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

export function parseQuoteMoneyInteger(
  value: unknown,
  errorCode: string,
  fieldName: string,
): number {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    throw new QuoteAccessError(
      400,
      errorCode,
      `${fieldName} deve ser um inteiro valido.`,
    );
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    throw new QuoteAccessError(
      400,
      errorCode,
      `${fieldName} deve ser um inteiro valido.`,
    );
  }

  return numericValue;
}

export function normalizeQuoteItemMoney(
  args: QuoteItemMoneyInput,
): NormalizedQuoteItemMoney {
  const quantity = parseQuoteMoneyInteger(
    args.quantity,
    args.errorCodes.quantity,
    "quantity",
  );
  const unitPriceCents = parseQuoteMoneyInteger(
    args.unitPriceCents,
    args.errorCodes.unitPriceCents,
    "unit_price_cents",
  );
  const discountCents = parseQuoteMoneyInteger(
    args.discountCents ?? 0,
    args.errorCodes.discountCents,
    "discount_cents",
  );

  if (quantity <= 0) {
    throw new QuoteAccessError(
      400,
      args.errorCodes.quantity,
      `Item ${args.itemIndex + 1} precisa ter quantidade maior que zero.`,
    );
  }

  if (unitPriceCents < 0) {
    throw new QuoteAccessError(
      400,
      args.errorCodes.unitPriceCents,
      `Item ${args.itemIndex + 1} nao pode ter preco unitario negativo.`,
    );
  }

  const subtotalCents = quantity * unitPriceCents;

  if (discountCents < 0 || discountCents > subtotalCents) {
    throw new QuoteAccessError(
      400,
      args.errorCodes.discountCents,
      `Item ${args.itemIndex + 1} possui desconto invalido.`,
    );
  }

  return {
    quantity,
    unitPriceCents,
    discountCents,
    subtotalCents,
    totalCents: subtotalCents - discountCents,
  };
}

export function sumQuoteItemMoneyTotals(
  items: Array<{
    subtotalCents: number;
    discountCents: number;
  }>,
): QuoteMoneyTotals {
  const subtotalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const discountCents = items.reduce((sum, item) => sum + item.discountCents, 0);

  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

export function resolveQuoteDiscountFromItems(args: {
  quoteDiscountCents: unknown;
  hasQuoteDiscountCents: boolean;
  itemsDiscountCents: number;
  errorCode: string;
}): number {
  if (!args.hasQuoteDiscountCents) {
    return args.itemsDiscountCents;
  }

  const quoteDiscountCents = parseQuoteMoneyInteger(
    args.quoteDiscountCents,
    args.errorCode,
    "discount_cents",
  );

  if (quoteDiscountCents !== args.itemsDiscountCents) {
    throw new QuoteAccessError(
      400,
      args.errorCode,
      "Quando items sao enviados, discount_cents deve corresponder ao desconto total dos itens.",
    );
  }

  return quoteDiscountCents;
}
