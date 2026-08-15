//! Thumbnail downscaling and encoding.
//!
//! Two tiers, for two different jobs (ARCHITECTURE.md §5.2):
//!   * portable — small, hard size cap, stored inside `.footagedb` so a shared
//!     library is still visual on a machine with no Drive access;
//!   * cache — larger, on local disk, disposable.

use crate::error::{AppError, Result};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::GenericImageView;

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

fn encode_jpeg(img: &image::DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
        .map_err(|e| AppError::Other(format!("Thumbnail encoding failed: {e}")))?;
    Ok(out)
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
pub fn portable(source: &[u8], max_edge: u32) -> Result<Encoded> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(AppError::Other("Image is too large to process".into()));
    }
    let img = image::load_from_memory(source)?;
    let mut scaled = fit(&img, max_edge);

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
    let img = image::load_from_memory(source)?;
    let scaled = fit(&img, CACHE_MAX_EDGE);
    let bytes = encode_jpeg(&scaled, 86)?;
    let (width, height) = scaled.dimensions();
    Ok(Encoded {
        bytes,
        width,
        height,
    })
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

    #[test]
    fn portable_thumbnails_respect_the_size_cap() {
        // 2000x1500 of pure noise is close to the worst case for JPEG.
        let e = portable(&png(2000, 1500), 480).unwrap();
        assert!(
            e.bytes.len() <= PORTABLE_MAX_BYTES,
            "got {} bytes, cap is {PORTABLE_MAX_BYTES}",
            e.bytes.len()
        );
        assert_eq!(e.width.max(e.height), 480);
    }

    #[test]
    fn aspect_ratio_is_preserved() {
        let e = portable(&png(1600, 400), 480).unwrap();
        assert_eq!((e.width, e.height), (480, 120));
    }

    #[test]
    fn images_smaller_than_the_target_are_not_upscaled() {
        let e = portable(&png(120, 90), 480).unwrap();
        assert_eq!((e.width, e.height), (120, 90));
    }

    #[test]
    fn oversized_input_is_refused_before_decoding() {
        let huge = vec![0u8; MAX_SOURCE_BYTES + 1];
        assert!(portable(&huge, 480).is_err());
    }

    #[test]
    fn garbage_input_fails_cleanly() {
        assert!(portable(b"this is not an image", 480).is_err());
    }

    #[test]
    fn cached_previews_are_larger_than_portable_ones() {
        let src = png(2400, 1600);
        let p = portable(&src, 480).unwrap();
        let c = cached(&src).unwrap();
        assert!(c.width > p.width);
        assert_eq!(c.width.max(c.height), CACHE_MAX_EDGE);
    }
}
