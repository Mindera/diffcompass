// Text assets are shared by the live UI and self-contained HTML exports.
// @ts-expect-error Bun's text loader embeds the approved SVG master.
import darkMark from "../public/brand/diffcompass-on-dark.svg" with { type: "text" };
// @ts-expect-error Bun's text loader embeds the approved SVG master.
import lightMark from "../public/brand/diffcompass-on-light.svg" with { type: "text" };
// @ts-expect-error Bun's text loader embeds the vector favicon.
import favicon from "../public/brand/favicon.svg" with { type: "text" };
// @ts-expect-error Bun's text loader embeds browser identity metadata.
import manifest from "../public/brand/site.webmanifest" with { type: "text" };

// The file loader includes binary artwork in compiled releases. Reading these
// imported paths with Bun.file also works when no public directory is present.
// @ts-expect-error Bun's file loader embeds the ICO asset.
import faviconIco from "../public/brand/favicon.ico" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import favicon16 from "../public/brand/favicon-16x16.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import favicon32 from "../public/brand/favicon-32x32.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import favicon48 from "../public/brand/favicon-48x48.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import appleTouchIcon from "../public/brand/apple-touch-icon.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import icon192 from "../public/brand/icon-192.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import icon512 from "../public/brand/icon-512.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import maskable192 from "../public/brand/icon-maskable-192.png" with { type: "file" };
// @ts-expect-error Bun's file loader embeds the PNG asset.
import maskable512 from "../public/brand/icon-maskable-512.png" with { type: "file" };

export const BRAND_FILES: Record<string, { body: BodyInit; contentType: string }> = {
  "brand/diffcompass-on-dark.svg": { body: String(darkMark), contentType: "image/svg+xml" },
  "brand/diffcompass-on-light.svg": { body: String(lightMark), contentType: "image/svg+xml" },
  "brand/favicon.svg": { body: String(favicon), contentType: "image/svg+xml" },
  "brand/site.webmanifest": { body: String(manifest), contentType: "application/manifest+json" },
  "brand/favicon.ico": { body: Bun.file(faviconIco), contentType: "image/x-icon" },
  "brand/favicon-16x16.png": { body: Bun.file(favicon16), contentType: "image/png" },
  "brand/favicon-32x32.png": { body: Bun.file(favicon32), contentType: "image/png" },
  "brand/favicon-48x48.png": { body: Bun.file(favicon48), contentType: "image/png" },
  "brand/apple-touch-icon.png": { body: Bun.file(appleTouchIcon), contentType: "image/png" },
  "brand/icon-192.png": { body: Bun.file(icon192), contentType: "image/png" },
  "brand/icon-512.png": { body: Bun.file(icon512), contentType: "image/png" },
  "brand/icon-maskable-192.png": { body: Bun.file(maskable192), contentType: "image/png" },
  "brand/icon-maskable-512.png": { body: Bun.file(maskable512), contentType: "image/png" },
};

export const brandMarkDataUrl = `data:image/svg+xml;base64,${Buffer.from(String(darkMark)).toString("base64")}`;
export const brandFaviconDataUrl = `data:image/svg+xml;base64,${Buffer.from(String(favicon)).toString("base64")}`;
