import { rgb } from "pdf-lib";

type RgbTuple = [number, number, number];

export type StoreBrandPdfTheme = {
  accentColor: ReturnType<typeof rgb> | null;
  accentTextColor: ReturnType<typeof rgb> | null;
  secondaryPanelColor: ReturnType<typeof rgb> | null;
  totalBackgroundColor: ReturnType<typeof rgb> | null;
  totalTextColor: ReturnType<typeof rgb> | null;
  documentFooter: string | null;
};

function parseOptionalHexColor(
  value: string | null | undefined
): RgbTuple | null {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(
    normalized
  );

  if (!match) {
    throw new Error("cor de marca invalida para PDF");
  }

  return [
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  ];
}

function toLinearChannel(channel: number) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbTuple) {
  return (
    0.2126 * toLinearChannel(color[0]) +
    0.7152 * toLinearChannel(color[1]) +
    0.0722 * toLinearChannel(color[2])
  );
}

function contrastRatio(a: RgbTuple, b: RgbTuple) {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
}

function readableAccentOnWhite(primary: RgbTuple): RgbTuple {
  const white: RgbTuple = [1, 1, 1];

  if (contrastRatio(primary, white) >= 4.5) {
    return primary;
  }

  for (let darken = 0.05; darken <= 0.9; darken += 0.05) {
    const candidate: RgbTuple = [
      primary[0] * (1 - darken),
      primary[1] * (1 - darken),
      primary[2] * (1 - darken),
    ];

    if (contrastRatio(candidate, white) >= 4.5) {
      return candidate;
    }
  }

  return [0, 0, 0];
}

function readableTextOnBackground(background: RgbTuple): RgbTuple {
  const black: RgbTuple = [0, 0, 0];
  const white: RgbTuple = [1, 1, 1];

  return contrastRatio(background, black) >= contrastRatio(background, white)
    ? black
    : white;
}

function createSecondaryPanelColor(secondary: RgbTuple): RgbTuple {
  const brandWeight = 0.12;
  const whiteWeight = 1 - brandWeight;

  return [
    secondary[0] * brandWeight + whiteWeight,
    secondary[1] * brandWeight + whiteWeight,
    secondary[2] * brandWeight + whiteWeight,
  ];
}

function toPdfColor(color: RgbTuple) {
  return rgb(color[0], color[1], color[2]);
}

export function resolveStoreBrandPdfTheme(args: {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  documentFooter?: string | null;
}): StoreBrandPdfTheme {
  const primary = parseOptionalHexColor(args.primaryColor);
  const secondary = parseOptionalHexColor(args.secondaryColor);

  return {
    accentColor: primary ? toPdfColor(primary) : null,
    accentTextColor: primary
      ? toPdfColor(readableAccentOnWhite(primary))
      : null,
    secondaryPanelColor: secondary
      ? toPdfColor(createSecondaryPanelColor(secondary))
      : null,
    totalBackgroundColor: primary ? toPdfColor(primary) : null,
    totalTextColor: primary
      ? toPdfColor(readableTextOnBackground(primary))
      : null,
    documentFooter:
      String(args.documentFooter ?? "").trim() || null,
  };
}