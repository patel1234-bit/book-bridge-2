from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed
from rest_framework import permissions


class SafeJWTAuthentication(JWTAuthentication):
    """
    Extends SimpleJWT's JWTAuthentication.

    For safe HTTP read-only methods (GET, HEAD, OPTIONS):
    If the Authorization header is present but the bearer token is expired,
    malformed, or invalid, it gracefully returns None (treating the requester
    as an AnonymousUser) rather than rejecting the entire request with 401.

    This ensures public read endpoints (such as browsing books or viewing
    site statistics) succeed seamlessly even if the visitor's browser has an
    old/expired token in localStorage.

    For state-changing methods (POST, PUT, PATCH, DELETE), any invalid or
    expired token raises an authentication error as required by security rules.
    """

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except (InvalidToken, AuthenticationFailed) as exc:
            if request.method in permissions.SAFE_METHODS:
                return None
            raise exc

