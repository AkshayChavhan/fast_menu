import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";

// GET /api/qr?url=<encoded url>[&size=512][&margin=2]
// Returns a PNG QR code for the given URL. Handy for embedding in
// print assets, emails, or <img src="/api/qr?url=..."> tags.
//
// The `url` param is validated with zod (must be a valid URL). The optional
// `size` (px) and `margin` (quiet-zone modules) params are clamped to sane
// bounds so this endpoint can't be used to render arbitrarily huge images.

const querySchema = z.object({
  url: z.string().url("`url` must be a valid absolute URL"),
  size: z.coerce.number().int().min(64).max(2048).optional().default(512),
  margin: z.coerce.number().int().min(0).max(16).optional().default(2),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = querySchema.safeParse({
    url: searchParams.get("url") ?? undefined,
    size: searchParams.get("size") ?? undefined,
    margin: searchParams.get("margin") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { url, size, margin } = parsed.data;

  try {
    const png = await QRCode.toBuffer(url, {
      type: "png",
      width: size,
      margin,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0a0a", light: "#ffffff" },
    });

    // Buffer -> ArrayBuffer view that Response accepts as a BodyInit.
    const body = new Uint8Array(png);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
        // Immutable for a day: the QR for a given URL never changes.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate QR code" },
      { status: 500 },
    );
  }
}
