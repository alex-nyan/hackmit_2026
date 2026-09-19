import base64
import io
import traceback
from datetime import UTC, datetime

import pytest
from PIL import Image

from triage.config import Settings
from triage.images import ImageError, prepare_image
from triage.schemas import BoundingBox, TriageRequest, VisionAssessment


def settings(**kwargs):
    return Settings(api_token="t" * 32, **kwargs)


def frame(raw, media_type="image/png"):
    return TriageRequest(
        image_base64=base64.b64encode(raw).decode(),
        media_type=media_type,
        source_id="camera-test",
        captured_at=datetime.now(UTC),
    )


def png(size=(20, 10)):
    buffer = io.BytesIO()
    Image.new("RGBA", size, (255, 0, 0, 128)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_normalizes_and_removes_metadata():
    buffer = io.BytesIO()
    source = Image.new("RGB", (20, 10), "red")
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private camera metadata"
    source.save(buffer, format="JPEG", exif=exif)
    prepared = prepare_image(frame(buffer.getvalue(), "image/jpeg"), settings())
    with Image.open(io.BytesIO(base64.b64decode(prepared.base64))) as normalized:
        assert normalized.format == "JPEG"
        assert normalized.size == (10, 20)
        assert not normalized.getexif()
    assert len(prepared.sha256) == 64
    assert prepared.image.mode == "RGB"


def test_alpha_flattens_on_white_and_downscales():
    prepared = prepare_image(frame(png((200, 200))), settings(image_max_side=128))
    assert prepared.image.size == (128, 128)
    assert prepared.image.getpixel((0, 0)) == (255, 127, 127)


@pytest.mark.parametrize(
    ("frame_request", "options", "code"),
    [
        (frame(b"not an image"), {}, "invalid_image"),
        (frame(png(), "image/jpeg"), {}, "image_type_mismatch"),
        (frame(png((100, 100))), {"max_image_pixels": 1024}, "image_pixel_limit"),
        (frame(b"a" * 1025), {"max_image_bytes": 1024}, "image_size_limit"),
    ],
)
def test_rejects_invalid_images(frame_request, options, code):
    with pytest.raises(ImageError, match=code):
        prepare_image(frame_request, settings(**options))


def test_rejects_invalid_base64():
    request = frame(png()).model_copy(update={"image_base64": "data:image/png;base64,AAAA"})
    with pytest.raises(ImageError, match="invalid_base64"):
        prepare_image(request, settings())


def test_rejects_animation():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(
        buffer, format="PNG", save_all=True, append_images=[Image.new("RGB", (10, 10), "blue")]
    )
    with pytest.raises(ImageError, match="animated_image_not_supported"):
        prepare_image(frame(buffer.getvalue()), settings())


@pytest.mark.parametrize("token", ["short", " " * 32, "界" * 32])
def test_auth_config_fails_closed(token):
    with pytest.raises(ValueError):
        Settings(api_token=token)


def test_cloud_config_requires_opt_in_and_https():
    with pytest.raises(ValueError):
        settings(vision_provider="openai_compatible")
    with pytest.raises(ValueError):
        settings(
            cloud_enabled=True,
            cloud_base_url="http://remote/v1",
            cloud_api_key="x",
            cloud_model="x",
        )


@pytest.mark.parametrize("token", ["short-private-token", "private-token-" + "x" * 32])
def test_startup_validation_traceback_does_not_expose_secrets(token):
    cloud_key = "private-cloud-key-" + "y" * 32
    with pytest.raises(ValueError) as error:
        Settings(
            _env_file=None,
            api_token=token,
            cloud_enabled=True,
            cloud_base_url="http://remote/v1",
            cloud_api_key=cloud_key,
            cloud_model="vision",
        )
    output = "".join(traceback.format_exception_only(error.value))
    assert "validation error for Settings" in output
    assert "private-token" not in output
    assert "private-cloud-key" not in output
    assert "input_value" not in output


@pytest.mark.parametrize(
    "url", ["http://evil.example", "http://localhost@evil.example", "http://localhost/api"]
)
def test_local_provider_boundary(url):
    with pytest.raises(ValueError):
        settings(ollama_base_url=url)


def test_confidence_and_bounding_box_contracts():
    with pytest.raises(ValueError):
        BoundingBox(x1=0.8, y1=0.0, x2=0.2, y2=1.0)
    with pytest.raises(ValueError):
        BoundingBox(x1=float("nan"), y1=0.0, x2=1.0, y2=1.0)
    with pytest.raises(ValueError):
        VisionAssessment(summary="", image_quality="adequate", hazards=[], limitations=[])
