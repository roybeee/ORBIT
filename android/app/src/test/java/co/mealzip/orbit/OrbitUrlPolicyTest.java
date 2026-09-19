package co.mealzip.orbit;
import org.junit.Test;
import static org.junit.Assert.*;

public class OrbitUrlPolicyTest {
    private static final String ORIGIN="https://orbit-personal-os.hflameb.chatgpt.site";
    @Test public void preservesOwnedConversationLink() {
        String url=ORIGIN+"/?conversation=synthetic-id#agent";
        assertEquals(url,OrbitUrlPolicy.sanitize(url,ORIGIN));
    }
    @Test public void rejectsSpoofedOriginsAndActiveSchemes() {
        for (String url : new String[]{"javascript:alert(1)", "file:///etc/passwd", "https://evil.test", ORIGIN+".evil.test/", "https://user@orbit-personal-os.hflameb.chatgpt.site/", ORIGIN+":444/", "http://orbit-personal-os.hflameb.chatgpt.site/", "https://orbit-personal-os.hflameb.chatgpt.site\\@evil.test", "not a url", null}) {
            assertEquals(ORIGIN+"/",OrbitUrlPolicy.sanitize(url,ORIGIN));
        }
    }
    @Test public void allowsDefaultTlsPortAndEncodedContent() {
        assertEquals(ORIGIN+":443/share", OrbitUrlPolicy.sanitize(ORIGIN+":443/share",ORIGIN));
        assertEquals(ORIGIN+"/?q=%ED%95%9C",OrbitUrlPolicy.sanitize(ORIGIN+"/?q=%ED%95%9C",ORIGIN));
    }
}
