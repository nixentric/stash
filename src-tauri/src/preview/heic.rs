//! HEIC decoding, for the webviews that cannot do it themselves.
//!
//! An iPhone photo is HEVC wrapped in HEIF. WKWebView decodes it because macOS
//! does; WebView2 and WebKitGTK do not, and neither does the `image` crate, so
//! a HEIC library was a wall of broken images everywhere but the Mac. libheif
//! is the decoder, and the rest of the app never sees the format: it asks for
//! pixels and gets pixels.
//!
//! macOS is deliberately left out. It needs nothing here, and skipping it keeps
//! `libheif.dylib` and its HEVC plugin out of the `.app` bundle.

use crate::error::{AppError, Result};

/// True for a HEIF-family container, from the bytes rather than the name.
///
/// `ftyp` is the first box of every ISO-BMFF file and its brand says which
/// dialect. Only the still-image brands are claimed — an `.mp4` shares the
/// container and must keep going to the video path.
pub fn is_heic(source: &[u8]) -> bool {
    if source.len() < 12 || &source[4..8] != b"ftyp" {
        return false;
    }
    matches!(
        &source[8..12],
        b"heic" | b"heix" | b"heim" | b"heis" | b"hevc" | b"hevx" | b"mif1" | b"msf1"
    )
}

#[cfg(not(target_os = "macos"))]
pub fn decode(source: &[u8]) -> Result<image::DynamicImage> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let lib = LibHeif::new();
    let ctx = HeifContext::read_from_bytes(source)
        .map_err(|e| AppError::Other(format!("Could not read this HEIC: {e}")))?;
    let handle = ctx
        .primary_image_handle()
        .map_err(|e| AppError::Other(format!("Could not read this HEIC: {e}")))?;

    // libheif applies the file's own rotation and mirror properties while
    // decoding, so what comes back is already the right way up.
    let image = lib
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| AppError::Other(format!("Could not decode this HEIC: {e}")))?;

    let planes = image.planes();
    let plane = planes
        .interleaved
        .ok_or_else(|| AppError::Other("HEIC decoded to no pixels".into()))?;

    let (w, h) = (plane.width as usize, plane.height as usize);
    let stride = plane.stride;
    // Rows are padded to the decoder's stride, so they are copied one at a time
    // rather than trusting the buffer to be exactly `w * h * 3` bytes.
    let mut rgb = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let row = &plane.data[y * stride..y * stride + w * 3];
        rgb.extend_from_slice(row);
    }

    image::RgbImage::from_raw(plane.width, plane.height, rgb)
        .map(image::DynamicImage::ImageRgb8)
        .ok_or_else(|| AppError::Other("HEIC decoded to an unusable buffer".into()))
}

/// macOS shows HEIC natively, so nothing here is built for it.
#[cfg(target_os = "macos")]
pub fn decode(_source: &[u8]) -> Result<image::DynamicImage> {
    Err(AppError::Other(
        "HEIC decoding is not built into the macOS build".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real thing, end to end. This is the check that catches a libheif
    /// built without its HEVC decoder — a build that compiles, links, and then
    /// cannot open a single iPhone photo.
    #[test]
    #[cfg(not(target_os = "macos"))]
    fn a_real_iphone_style_heic_decodes_to_pixels() {
        let raw = include_bytes!("../../tests/fixtures/sample.heic");
        assert!(is_heic(raw));
        let img = decode(raw).expect("libheif has no HEVC decoder in this build");
        assert!(img.width() > 100 && img.height() > 100);
    }

    #[test]
    fn heif_brands_are_recognized_and_nothing_else_is() {
        let mut heic = b"\0\0\0\x18ftypheic".to_vec();
        heic.extend_from_slice(&[0; 8]);
        assert!(is_heic(&heic));

        let mut mp4 = b"\0\0\0\x18ftypisom".to_vec();
        mp4.extend_from_slice(&[0; 8]);
        assert!(!is_heic(&mp4));

        assert!(!is_heic(b"\xff\xd8\xff\xe0 a jpeg"));
        // A truncated file must not panic on the slice.
        assert!(!is_heic(b"\0\0\0"));
    }
}

#[cfg(test)]
mod local_decode {
    /// Point at a real HEIC to check the decoder end to end:
    /// `STASH_HEIC=/path/to/photo.heic cargo test decodes_a_real_heic -- --nocapture`
    #[test]
    fn decodes_a_real_heic() {
        let Ok(path) = std::env::var("STASH_HEIC") else {
            return;
        };
        let raw = std::fs::read(path).unwrap();
        assert!(super::is_heic(&raw), "not a HEIF container");
        let img = super::decode(&raw).unwrap();
        assert!(img.width() > 0 && img.height() > 0);
        let jpeg = crate::preview::encode::to_web_still(&raw).unwrap();
        assert_eq!(&jpeg[..2], &[0xff, 0xd8], "not a JPEG");
        println!("decoded {}x{} -> {} KB", img.width(), img.height(), jpeg.len() / 1024);
    }
}
