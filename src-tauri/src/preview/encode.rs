//! Thumbnail downscaling and encoding.
//!
//! Two tiers, for two different jobs (ARCHITECTURE.md §5.2):
//!   * portable — small, hard size cap, stored inside `.footagedb` so a shared
//!     library is still visual on a machine with no Drive access;
//!   * cache — larger, on local disk, disposable.

use crate::error::{AppError, Result};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{GenericImageView, ImageDecoder};

/// Hard ceiling for a portable thumbnail. At 10k items this bounds the library's
/// thumbnail payload at ~640 MB worst case and ~350 MB in practice; without a cap
/// a single pathological source could bloat the file without limit.
pub const PORTABLE_MAX_BYTES: usize = 64 * 1024;

/// Longest edge of the disk-cached preview used by Quick Look.
pub const CACHE_MAX_EDGE: u32 = 1600;

/// Refuse absurd inputs before decoding — a decompression bomb would otherwise
/// be allocated in full before we ever get to resize it.
pub const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// True for anything that looks like SVG markup rather than a raster container.
fn is_svg(source: &[u8]) -> bool {
    let head = &source[..source.len().min(1024)];
    let text = String::from_utf8_lossy(head);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    text.starts_with("<?xml") || text.starts_with("<svg") || text.starts_with("<!DOCTYPE svg")
}

/// Rasterizes SVG at `max_edge` so the rest of the pipeline sees ordinary pixels.
///
/// Logos are the reason this exists — a brand kit's mark is usually vector, and
/// without this it has no thumbnail at all.
fn rasterize_svg(source: &[u8], max_edge: u32) -> Result<image::DynamicImage> {
    let mut options = resvg::usvg::Options::default();
    // Text in an SVG needs real fonts; without these it silently renders as nothing.
    options.fontdb_mut().load_system_fonts();

    let tree = resvg::usvg::Tree::from_data(source, &options)
        .map_err(|e| AppError::Other(format!("Could not read this SVG: {e}")))?;

    let size = tree.size();
    let longest = size.width().max(size.height());
    if longest <= 0.0 {
        return Err(AppError::Other("SVG has no drawable area".into()));
    }
    // Rendered straight to the target size rather than at its nominal one, then
    // downscaled: a 200pt mark should still fill a 480px thumbnail crisply.
    let scale = max_edge as f32 / longest;
    let (w, h) = ((size.width() * scale).ceil() as u32, (size.height() * scale).ceil() as u32);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(w.max(1), h.max(1))
        .ok_or_else(|| AppError::Other("SVG has no drawable area".into()))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    // tiny-skia stores premultiplied pixels; PNG wants them straight.
    let mut rgba = Vec::with_capacity((pixmap.width() * pixmap.height() * 4) as usize);
    for px in pixmap.pixels() {
        let c = px.demultiply();
        rgba.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }

    let buf = image::RgbaImage::from_raw(pixmap.width(), pixmap.height(), rgba)
        .ok_or_else(|| AppError::Other("SVG rasterized to an unusable buffer".into()))?;
    Ok(image::DynamicImage::ImageRgba8(buf))
}

/// Decodes any source the pipeline accepts, vector or raster.
///
/// EXIF orientation is applied here. A phone photo stores its pixels sideways
/// and a rotation tag next to them; the webview honors that tag when it shows
/// the original, so a thumbnail that ignores it comes out rotated against its
/// own preview.
fn decode(source: &[u8], max_edge: u32) -> Result<image::DynamicImage> {
    if is_svg(source) {
        return rasterize_svg(source, max_edge);
    }
    if super::heic::is_heic(source) {
        return super::heic::decode(source);
    }
    let mut decoder = image::ImageReader::new(std::io::Cursor::new(source))
        .with_guessed_format()?
        .into_decoder()?;
    // A missing or malformed tag just means "upright".
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    Ok(img)
}

fn encode_jpeg(img: &image::DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
        .map_err(|e| AppError::Other(format!("Thumbnail encoding failed: {e}")))?;
    Ok(out)
}

fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| AppError::Other(format!("Thumbnail encoding failed: {e}")))?;
    Ok(out.into_inner())
}

/// Whether the image actually uses its alpha channel.
///
/// Having one is not the same as using it: plenty of PNGs are fully opaque RGBA.
/// This matters because JPEG cannot carry alpha, and flattening a logo's
/// transparent background to black is indistinguishable from a logo drawn on
/// black — which is exactly the question the logo preview needs to answer.
fn uses_alpha(img: &image::DynamicImage) -> bool {
    img.color().has_alpha() && img.to_rgba8().pixels().any(|p| p.0[3] < 250)
}

fn fit(img: &image::DynamicImage, max_edge: u32) -> image::DynamicImage {
    let (w, h) = img.dimensions();
    if w.max(h) <= max_edge {
        return img.clone();
    }
    // `resize` preserves aspect ratio within the bounding box.
    img.resize(max_edge, max_edge, FilterType::Triangle)
}

/// Downscales to `max_edge` and encodes under `PORTABLE_MAX_BYTES`.
///
/// Quality is stepped down rather than the image being rejected, so a stubborn
/// source still produces *something* visual instead of a placeholder.
pub fn portable(source: &[u8], max_edge: u32, keep_alpha: bool) -> Result<Encoded> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::Other("Image is too large to process".into()));
    }
    let img = decode(source, max_edge)?;
    let mut scaled = fit(&img, max_edge);

    // Only where transparency is part of the point — a brand logo sits on whatever
    // background the guideline puts behind it, so flattening it to white or black
    // destroys the thing being documented. Ordinary footage stays JPEG: smaller,
    // and nothing in the library depends on its alpha.
    if keep_alpha && uses_alpha(&img) {
        for edge in [max_edge, max_edge * 3 / 4, max_edge / 2] {
            let candidate = fit(&scaled, edge);
            let bytes = encode_png(&candidate)?;
            if bytes.len() <= PORTABLE_MAX_BYTES {
                let (width, height) = candidate.dimensions();
                return Ok(Encoded { bytes, width, height });
            }
        }
    }

    for quality in [78u8, 68, 58, 45, 35] {
        let bytes = encode_jpeg(&scaled, quality)?;
        if bytes.len() <= PORTABLE_MAX_BYTES {
            let (width, height) = scaled.dimensions();
            return Ok(Encoded {
                bytes,
                width,
                height,
            });
        }
    }

    // Still too big at the lowest quality: shrink the pixels instead.
    scaled = fit(&scaled, max_edge / 2);
    let bytes = encode_jpeg(&scaled, 60)?;
    let (width, height) = scaled.dimensions();
    Ok(Encoded {
        bytes,
        width,
        height,
    })
}

/// Larger preview for the local cache. No byte cap — the disk cache is
/// disposable and never travels with the library.
pub fn cached(source: &[u8]) -> Result<Encoded> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::Other("Image is too large to process".into()));
    }
    let img = decode(source, CACHE_MAX_EDGE)?;
    let scaled = fit(&img, CACHE_MAX_EDGE);
    let bytes = encode_jpeg(&scaled, 86)?;
    let (width, height) = scaled.dimensions();
    Ok(Encoded {
        bytes,
        width,
        height,
    })
}

/// The same picture, in something the webview will actually decode.
///
/// Full resolution and no size cap beyond the input guard: this is the file the
/// user opened, not a thumbnail of it. Quality 95 is the top of the useful
/// range — above it the file doubles and nothing on a screen changes — and the
/// HEIC on disk is untouched either way, so nothing about the original is lost.
pub fn to_web_still(source: &[u8]) -> Result<Vec<u8>> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::Other("Image is too large to process".into()));
    }
    // ponytail: transcoded per request. A 12 MP HEIC is ~0.5 s; cache it next to
    // the preview cache if reopening the same photo ever feels slow.
    encode_jpeg(&decode(source, u32::MAX)?, 95)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut img = image::RgbImage::new(w, h);
        // Noise, so the encoder cannot cheat with a flat-colour image.
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb([(x % 251) as u8, (y % 253) as u8, ((x * y) % 247) as u8]);
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    /// A mark on a transparent field: the shape is dark, everything around it is
    /// see-through. Flattened to JPEG this is indistinguishable from a dark logo
    /// on black, which is the bug this guards.
    fn transparent_logo(w: u32, h: u32) -> Vec<u8> {
        let mut img = image::RgbaImage::new(w, h);
        for (x, y, p) in img.enumerate_pixels_mut() {
            let inside = x > w / 4 && x < w * 3 / 4 && y > h / 4 && y < h * 3 / 4;
            *p = if inside {
                image::Rgba([20, 20, 20, 255])
            } else {
                image::Rgba([0, 0, 0, 0])
            };
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn a_transparent_logo_keeps_its_transparency_and_stays_under_the_cap() {
        let e = portable(&transparent_logo(800, 600), 480, true).unwrap();
        assert!(e.bytes.len() <= PORTABLE_MAX_BYTES);

        let decoded = image::load_from_memory(&e.bytes).unwrap();
        assert!(decoded.color().has_alpha(), "alpha channel was dropped");
        assert!(
            decoded.to_rgba8().pixels().any(|p| p.0[3] == 0),
            "transparent pixels were flattened"
        );
    }

    /// A vector mark on a transparent canvas — the shape most brand logos ship as,
    /// and the one the raster decoder cannot open at all.
    const SVG_MARK: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
         <rect x="50" y="25" width="100" height="50" fill="#1420f5"/>
       </svg>"##;

    #[test]
    fn an_svg_logo_is_rasterized_instead_of_being_skipped() {
        let e = portable(SVG_MARK.as_bytes(), 480, true).unwrap();
        assert_eq!(&e.bytes[..2], &[0x89, 0x50], "expected a PNG header");
        assert_eq!((e.width, e.height), (480, 240), "viewBox aspect is kept");

        let decoded = image::load_from_memory(&e.bytes).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(5, 5).0[3], 0, "outside the mark stays transparent");
        assert_eq!(decoded.get_pixel(240, 120).0[3], 255, "the mark itself is opaque");
    }

    #[test]
    fn svg_detection_is_not_fooled_by_a_raster_file() {
        assert!(!is_svg(&png(8, 8)));
        assert!(is_svg(SVG_MARK.as_bytes()));
        assert!(is_svg(br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>"#));
    }

    /// Transparency is kept for brand logos and nowhere else, so the same image
    /// imported as ordinary footage stays a small flat JPEG.
    #[test]
    fn the_same_logo_outside_a_brand_stays_jpeg() {
        let e = portable(&transparent_logo(800, 600), 480, false).unwrap();
        assert_eq!(&e.bytes[..2], &[0xFF, 0xD8], "expected a JPEG header");
    }

    #[test]
    fn an_opaque_photo_still_goes_out_as_jpeg() {
        let e = portable(&png(1200, 900), 480, true).unwrap();
        assert_eq!(&e.bytes[..2], &[0xFF, 0xD8], "expected a JPEG header");
    }

    #[test]
    fn portable_thumbnails_respect_the_size_cap() {
        // 2000x1500 of pure noise is close to the worst case for JPEG.
        let e = portable(&png(2000, 1500), 480, false).unwrap();
        assert!(
            e.bytes.len() <= PORTABLE_MAX_BYTES,
            "got {} bytes, cap is {PORTABLE_MAX_BYTES}",
            e.bytes.len()
        );
        assert_eq!(e.width.max(e.height), 480);
    }

    #[test]
    fn aspect_ratio_is_preserved() {
        let e = portable(&png(1600, 400), 480, false).unwrap();
        assert_eq!((e.width, e.height), (480, 120));
    }

    #[test]
    fn images_smaller_than_the_target_are_not_upscaled() {
        let e = portable(&png(120, 90), 480, false).unwrap();
        assert_eq!((e.width, e.height), (120, 90));
    }

    #[test]
    fn oversized_input_is_refused_before_decoding() {
        let huge = vec![0u8; MAX_SOURCE_BYTES + 1];
        assert!(portable(&huge, 480, false).is_err());
    }

    #[test]
    fn garbage_input_fails_cleanly() {
        assert!(portable(b"this is not an image", 480, false).is_err());
    }

    #[test]
    fn cached_previews_are_larger_than_portable_ones() {
        let src = png(2400, 1600);
        let p = portable(&src, 480, false).unwrap();
        let c = cached(&src).unwrap();
        assert!(c.width > p.width);
        assert_eq!(c.width.max(c.height), CACHE_MAX_EDGE);
    }
}
