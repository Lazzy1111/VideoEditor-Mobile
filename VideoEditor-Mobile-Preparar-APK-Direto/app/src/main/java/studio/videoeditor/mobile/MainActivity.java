package studio.videoeditor.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.IOException;
import java.io.OutputStream;

/** Contêiner Android para o editor HTML5. Não envia a mídia para um servidor. */
public final class MainActivity extends Activity {
    private static final int FILE_PICKER_REQUEST = 512;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;
    private final SaveBridge saveBridge = new SaveBridge();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(11,13,24));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(11,13,24));
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(11,13,24));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Somente conteúdo local; nenhum site externo é carregado.
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                return !("https".equals(target.getScheme())
                    && "appassets.androidplatform.net".equals(target.getHost())
                    && target.getPath() != null && target.getPath().startsWith("/assets/"));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException err) {
                    pendingFileChooser.onReceiveValue(null);
                    pendingFileChooser = null;
                    return false;
                }
            }
        });
        // Interface exclusivamente para salvar vídeo; não dá à página acesso arbitrário a arquivos.
        webView.addJavascriptInterface(saveBridge, "NativeSaver");
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode == FILE_PICKER_REQUEST && pendingFileChooser != null){
            pendingFileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
            pendingFileChooser=null;
        }
    }

    @Override public void onBackPressed(){
        if(webView != null && webView.canGoBack())webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy(){
        saveBridge.cancelSave();
        if(webView != null)webView.destroy();
        super.onDestroy();
    }

    /** Recebe dados em blocos pequenos e grava com MediaStore, sem permissões invasivas. */
    private final class SaveBridge {
        private Uri currentUri;
        private OutputStream output;
        private boolean broken;

        @JavascriptInterface public synchronized String beginSave(String name, String mime, double bytes){
            cancelSave();
            try{
                if(!mime.startsWith("video/"))return "Formato de vídeo inválido";
                String filename=name.replaceAll("[^a-zA-Z0-9._ -]", "_");
                if(filename.isEmpty())filename="VideoEditor.mp4";
                ContentValues data=new ContentValues();
                data.put(MediaStore.Video.Media.DISPLAY_NAME,filename);
                data.put(MediaStore.Video.Media.MIME_TYPE,mime.split(";")[0]);
                data.put(MediaStore.Video.Media.RELATIVE_PATH,Environment.DIRECTORY_MOVIES+"/VideoEditor");
                data.put(MediaStore.Video.Media.IS_PENDING,1);
                currentUri=getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,data);
                if(currentUri==null)return "Não foi possível criar arquivo";
                output=getContentResolver().openOutputStream(currentUri,"w");
                if(output==null)throw new IOException("Sem acesso ao arquivo");
                broken=false;
                return "OK";
            }catch(Exception e){cancelSave();return "Erro: "+e.getMessage();}
        }
        @JavascriptInterface public synchronized String appendData(String b64){
            if(output==null||broken)return "Arquivo não inicializado";
            try{
                byte[] data=Base64.decode(b64,Base64.DEFAULT);
                output.write(data);
                return "OK";
            }catch(Exception e){broken=true;return "Erro ao gravar: "+e.getMessage();}
        }
        @JavascriptInterface public synchronized String finishSave(){
            if(output==null||broken){cancelSave();return "Vídeo incompleto";}
            try{
                output.flush();output.close();output=null;
                ContentValues values=new ContentValues();values.put(MediaStore.Video.Media.IS_PENDING,0);
                getContentResolver().update(currentUri,values,null,null);
                currentUri=null;
                return "OK";
            }catch(Exception e){cancelSave();return "Erro ao finalizar: "+e.getMessage();}
        }
        @JavascriptInterface public synchronized void cancelSave(){
            if(output!=null){try{output.close();}catch(Exception ignored){}output=null;}
            if(currentUri!=null){try{getContentResolver().delete(currentUri,null,null);}catch(Exception ignored){}currentUri=null;}
            broken=false;
        }
    }
}
