"""Decode once at the trust boundary; never pass original metadata to providers."""

import base64
import binascii
import hashlib
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from triage.config import Settings
from triage.schemas import TriageRequest


class ImageError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class PreparedImage:
    image: Image.Image
    base64: str
    sha256: str


def prepare_image(request: TriageRequest, settings: Settings) -> PreparedImage:
    try:
        raw = base64.b64decode(request.image_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ImageError("invalid_base64") from error
    if not raw or len(raw) > settings.max_image_bytes:
        raise ImageError("image_size_limit")
    expected = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format != expected[request.media_type]:
                    raise ImageError("image_type_mismatch")
                if source.width * source.height > settings.max_image_pixels:
                    raise ImageError("image_pixel_limit")
                if getattr(source, "n_frames", 1) != 1:
                    raise ImageError("animated_image_not_supported")
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                normalized = ImageOps.exif_transpose(source)
                normalized.thumbnail((settings.image_max_side, settings.image_max_side))
                rgba = normalized.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                background.alpha_composite(rgba)
                image = background.convert("RGB")
                # Fresh pixel image prevents EXIF, XMP, and ICC metadata forwarding.
                image.info.clear()
    except ImageError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ImageError("image_pixel_limit") from error
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as error:
        raise ImageError("invalid_image") from error
    encoded = io.BytesIO()
    image.save(encoded, format="JPEG", quality=90)
    return PreparedImage(
        image=image,
        base64=base64.b64encode(encoded.getvalue()).decode("ascii"),
        sha256=hashlib.sha256(raw).hexdigest(),
    )
