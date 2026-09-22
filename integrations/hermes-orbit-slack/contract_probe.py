"""Read-only diagnostic. Never prints credentials, response bodies or record data."""
import json
import os
from urllib import error, parse, request


def main():
    endpoint = os.environ.get('ORBIT_SLACK_DIRECTIVE_URL', '')
    token = os.environ.get('ORBIT_SLACK_INGEST_KEY', '')
    url = parse.urlsplit(endpoint)
    if url.scheme != 'https' or not url.netloc or url.username or url.query or url.fragment or not token:
        print(json.dumps({'contract_verified': False, 'blocker': 'configuration_missing_or_invalid'}))
        return 2
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    req = request.Request(endpoint + '?id=contract-probe-nonexistent-t_44ee3a1f',
                          headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        response = request.build_opener(NoRedirect).open(req, timeout=20)
    except error.HTTPError as exc:
        response = exc
    except Exception as exc:
        print(json.dumps({'contract_verified': False, 'error_type': type(exc).__name__}))
        return 2
    with response:
        body = response.read(100001)
        output = {'method': 'GET', 'path': url.path, 'http_status': response.code,
                  'content_type': response.headers.get('Content-Type', ''),
                  'contract_verified': False}
        try:
            decoded = json.loads(body)
            output['json_object'] = isinstance(decoded, dict)
            # Shape booleans only; even key strings from a remote body are untrusted.
            output['has_receipt_fields'] = isinstance(decoded, dict) and all(k in decoded for k in ('id', 'source', 'change', 'status'))
        except (ValueError, UnicodeError):
            output['json_object'] = False
        output['note'] = 'Read-only existence probe only; never proves POST, idempotency or target readback.'
        print(json.dumps(output, sort_keys=True))
    return 2  # No valid real receipt was read; this is not a release gate pass.


if __name__ == '__main__':
    raise SystemExit(main())
