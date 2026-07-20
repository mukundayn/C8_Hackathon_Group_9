"""Classifier → image_analyzer routing when a screenshot is attached."""

from app.routing import route_after_classifier
from app.image_store import clear_pending_image, put_pending_image


def test_routes_to_remediation_without_image():
    assert route_after_classifier({"issues": []}) == "remediation"


def test_routes_to_image_analyzer_when_has_image_flag():
    assert route_after_classifier({"has_image": True}) == "image_analyzer"


def test_routes_to_image_analyzer_when_image_ref():
    ref = "test-img-ref-1"
    put_pending_image(ref, "abc123", mime="image/png", description="shot")
    try:
        assert route_after_classifier({"image_ref": ref, "has_image": True}) == "image_analyzer"
    finally:
        clear_pending_image(ref)
