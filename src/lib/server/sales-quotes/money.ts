import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";

export const POSTGRES_INT4_MAX = 2147483647;

const INVALID_QUOTE_MONEY_TOTALS = "INVALID_QUOTE_MONEY_TOTALS";
const INVALID_ITEM_SUBTOTAL = "INVALID_ITEM_SUBTOTAL";
const INVALID_ITEM_TOTAL = "INVALID_ITEM_TOTAL";

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

  if (
    !Number.isFinite(numericValue) ||
    !Number.isInteger(numericValue) ||
    !Number.isSafeInteger(numericValue)
  ) {
    throw new QuoteAccessError(
      400,
      errorCode,
      `${fieldName} deve ser um inteiro valido.`,
    );
  }

  return numericValue;
}

function assertQuoteMoneyCents(
  value: number,
  errorCode: string,
  fieldName: string,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > POSTGRES_INT4_MAX
  ) {
    throw new QuoteAccessError(
      400,
      errorCode,
      `${fieldName} deve estar entre 0 e ${POSTGRES_INT4_MAX}.`,
    );
  }
}

function addQuoteMoneyCents(args: {
  current: number;
  next: number;
  errorCode: string;
  fieldName: string;
}) {
  assertQuoteMoneyCents(args.current, args.errorCode, args.fieldName);
  assertQuoteMoneyCents(args.next, args.errorCode, args.fieldName);

  const sum = args.current + args.next;
  assertQuoteMoneyCents(sum, args.errorCode, args.fieldName);

  return sum;
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
  assertQuoteMoneyCents(
    unitPriceCents,
    args.errorCodes.unitPriceCents,
    "unit_price_cents",
  );
  assertQuoteMoneyCents(
    discountCents,
    args.errorCodes.discountCents,
    "discount_cents",
  );

  const subtotalCents = quantity * unitPriceCents;
  assertQuoteMoneyCents(
    subtotalCents,
    INVALID_ITEM_SUBTOTAL,
    "subtotal_cents",
  );

  if (discountCents < 0 || discountCents > subtotalCents) {
    throw new QuoteAccessError(
      400,
      args.errorCodes.discountCents,
      `Item ${args.itemIndex + 1} possui desconto invalido.`,
    );
  }
  const totalCents = subtotalCents - discountCents;
  assertQuoteMoneyCents(totalCents, INVALID_ITEM_TOTAL, "total_cents");

  return {
    quantity,
    unitPriceCents,
    discountCents,
    subtotalCents,
    totalCents,
  };
}

export function sumQuoteItemMoneyTotals(
  items: Array<{
    subtotalCents: number;
    discountCents: number;
  }>,
): QuoteMoneyTotals {
  let subtotalCents = 0;
  let discountCents = 0;

  for (const item of items) {
    subtotalCents = addQuoteMoneyCents({
      current: subtotalCents,
      next: item.subtotalCents,
      errorCode: INVALID_QUOTE_MONEY_TOTALS,
      fieldName: "subtotal_cents",
    });
    discountCents = addQuoteMoneyCents({
      current: discountCents,
      next: item.discountCents,
      errorCode: INVALID_QUOTE_MONEY_TOTALS,
      fieldName: "discount_cents",
    });
  }
  const totalCents = subtotalCents - discountCents;
  assertQuoteMoneyCents(
    totalCents,
    INVALID_QUOTE_MONEY_TOTALS,
    "total_cents",
  );

  return {
    subtotalCents,
    discountCents,
    totalCents,
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
  assertQuoteMoneyCents(
    quoteDiscountCents,
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
