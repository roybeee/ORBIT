package co.mealzip.orbit;

import java.net.URI;

/** No caller may use ORBIT as a launcher for an arbitrary origin or URL scheme. */
public final class OrbitUrlPolicy {
    private OrbitUrlPolicy() {}

    public static String sanitize(String candidate, String origin) {
        String fallback = origin + "/";
        if (candidate == null || candidate.length() > 8192) return fallback;
        try {
            URI value = new URI(candidate);
            URI expected = new URI(origin);
            if (!"https".equalsIgnoreCase(value.getScheme()) || value.getUserInfo() != null
                    || value.getHost() == null || !value.getHost().equalsIgnoreCase(expected.getHost())
                    || (value.getPort() != -1 && value.getPort() != 443)) return fallback;
            return value.toASCIIString();
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
