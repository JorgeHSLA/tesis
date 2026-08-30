# API real de `google-cloud-storage` + OAuth de escritorio (Google) — investigación para el catálogo remoto de Telar

Todo lo que sigue está **verificado empíricamente** contra las librerías instaladas (venv de scratchpad: `/tmp/claude-1000/-mnt-d-universidad-tesis/8ed73b89-b7d2-4f33-b7b0-3f23fa27dbf2/scratchpad/gcsenv`) o citado de documentación oficial. Marco explícitamente lo que es introspección real, lo que es prueba en vivo contra un bucket público, y lo que no pude confirmar.

Versiones exactas instaladas y usadas para verificar:

```
google-cloud-storage     3.13.1
google-auth              2.57.0
google-api-core          2.34.0
google-cloud-core         2.7.0
google-resumable-media   2.10.2
google-crc32c             1.8.0
google-auth-oauthlib      1.4.1
requests-oauthlib         2.0.0
oauthlib                  3.3.1
```

---

## 1. `google-cloud-storage`

### 1.1 Paquete y pin

- **Nombre en PyPI:** `google-cloud-storage`
- **Última estable:** `3.13.1`
- **`requires_python`:** `>=3.10` (compatible con el Python 3.12 del backend)
- **Dependencias declaradas:** `google-auth>=2.26.1,<3`, `google-api-core>=2.27.0,<3`, `google-cloud-core>=2.4.2,<3`, `google-resumable-media>=2.7.2,<3`, `requests>=2.22.0,<3`, `google-crc32c>=1.6.0,<2`

Pin coherente con el estilo de `backend/requirements.txt` (rangos `>=X,<Y+1`):

```
google-cloud-storage>=3.13,<4
google-auth-oauthlib>=1.4,<2     # solo para el flujo OAuth del admin
```

Ojo con `requests>=2.22,<3`: el backend hoy no lo trae directo (usa `httpx` vía `fastapi[standard]`), así que este paquete añade `requests` + `urllib3` al árbol de producción. Es un argumento real a favor de la **alternativa sin SDK** de §1.8 para el lado estudiante.

### 1.2 Cliente anónimo para bucket público

Fuente real, `inspect.getsource(storage.Client.create_anonymous_client)` en 3.13.1:

```python
@classmethod
def create_anonymous_client(cls):
    """Factory: return client with anonymous credentials.

    .. note::

       Such a client has only limited access to "public" buckets:
       listing their contents and downloading their blobs.

    :rtype: :class:`google.cloud.storage.client.Client`
    :returns: Instance w/ anonymous credentials and no project.
    """
    client = cls(project="<none>", credentials=AnonymousCredentials())
    client.project = None
    return client
```

Es decir: **no toma argumentos**, y deja `client.project is None`. Verificado en vivo (`client.project = None`).

Prueba real contra un bucket público (`gcp-public-data-landsat`), ejecutada en esta sesión:

```python
from google.cloud import storage

client = storage.Client.create_anonymous_client()
bucket = client.bucket("gcp-public-data-landsat")   # NO hace HTTP
blobs = client.list_blobs(bucket, prefix="LC08/01/044/034/", max_results=5)
print([b.name for b in blobs])
# ['LC08/01/044/034/.../..._ANG.txt', '..._B1.TIF', ...]
```

**Punto de diseño importante:** `Client.bucket(name)` es un *factory* puro (sin request HTTP). `Client.get_bucket(name)` sí hace HTTP y requiere el permiso `storage.buckets.get`. Para el catálogo de Telar, usar siempre `client.bucket(...)` y nunca `get_bucket(...)`: así el bucket solo necesita conceder a `allUsers` el rol `roles/storage.objectViewer` (`storage.objects.get` + `storage.objects.list`), sin exponer metadatos del bucket.

Firmas reales:

```python
Client.__init__(self, project=<sentinel>, credentials=None, _http=None,
                client_info=None, client_options=None,
                use_auth_w_custom_endpoint=True, extra_headers={}, *, api_key=None)

Client.bucket(self, bucket_name, user_project=None, generation=None)
```

### 1.3 Listar objetos con prefijo

Firma real de `Client.list_blobs` en 3.13.1 (nótese `filter_` al final, nuevo respecto a la doc de Context7):

```python
Client.list_blobs(
    self, bucket_or_name, max_results=None, page_token=None, prefix=None,
    delimiter=None, start_offset=None, end_offset=None,
    include_trailing_delimiter=None, versions=None, projection='noAcl',
    fields=None, page_size=None, timeout=60, retry=<DEFAULT_RETRY>,
    match_glob=None, include_folders_as_prefixes=None, soft_deleted=None,
    filter_=None,
)
```

`bucket_or_name` acepta **el nombre como `str`** directamente, además de un `Bucket`.

Existe también `Bucket.list_blobs(...)` con los mismos filtros (sin `bucket_or_name`, con `client=None`).

Patrón "carpetas" (útil si el layout del bucket es `modulos/<module_id>/<version>.json`):

```python
it = client.list_blobs(bucket, prefix="modulos/", delimiter="/")
objetos = list(it)          # hay que AGOTAR el iterador primero…
carpetas = list(it.prefixes) # …o `prefixes` sale vacío. Gotcha real, verificado.
```

Salida real de la prueba en vivo con `delimiter="/"`:

```
delimiter prefixes: ['LC08/01/044/034/LC08_L1GT_044034_20130330_20180201_01_T2/', ...]
```

Paginación: el retorno es un `HTTPIterator` de `google.api_core.page_iterator`; se recorre con `for blob in it`, o página a página con `for page in it.pages` y `it.next_page_token`. `max_results` acota el total; `page_size` acota cada request.

Alternativa más expresiva para el catálogo: `match_glob="modulos/*/manifest.json"` (soportado por la API v1 de GCS y expuesto en el cliente).

### 1.4 Descargar un blob a memoria (bytes / texto)

Firmas reales:

```python
Blob.download_as_bytes(
    self, client=None, start=None, end=None, raw_download=False,
    if_etag_match=None, if_etag_not_match=None,
    if_generation_match=None, if_generation_not_match=None,
    if_metageneration_match=None, if_metageneration_not_match=None,
    timeout=60, checksum='auto', retry=<DEFAULT_RETRY>, single_shot_download=False,
)

Blob.download_as_text(
    self, client=None, start=None, end=None, raw_download=False, encoding=None,
    if_etag_match=None, if_etag_not_match=None,
    if_generation_match=None, if_generation_not_match=None,
    if_metageneration_match=None, if_metageneration_not_match=None,
    timeout=60, retry=<DEFAULT_RETRY>, single_shot_download=False,
)
```

Uso real (probado en vivo):

```python
blob = bucket.blob("modulos/m3/v7.json")
texto = blob.download_as_text()            # encoding: charset del content-type, si no utf-8
crudo = blob.download_as_bytes()           # checksum='auto' → valida crc32c/md5 del servidor
```

Tres cosas que importan para "contenido remoto = entrada no confiable":

1. **`checksum='auto'` está activo por defecto** en `download_as_bytes`: la librería ya compara crc32c/md5 contra los headers de GCS y lanza `google.cloud.storage.exceptions.DataCorruption` si no cuadra. Esto **no sustituye** el `checksum` sha256 propio de Telar (aquel valida *contenido educativo firmado por el admin*, éste solo valida *transporte*), pero es una capa gratis.
2. **Anclar la versión exacta con `if_generation_match`.** Si el catálogo publica el `generation` del blob, el estudiante puede descargar exactamente ese objeto y no una versión sobreescrita a mitad de operación. Verificado en vivo: un `generation` que no coincide levanta `google.api_core.exceptions.PreconditionFailed` con `code == 412`.
3. **Poner un tope de tamaño antes de parsear.** `download_as_bytes` carga todo a RAM sin límite. Antes de descargar conviene `blob.reload()` (o leer `blob.size` del listado) y rechazar cualquier módulo por encima de un máximo configurado. `start=`/`end=` permiten además un descargue por rango.

Propiedades de metadatos disponibles tras `reload()` o tras el listado: `metadata`, `content_type`, `cache_control`, `md5_hash`, `crc32c`, `generation`, `metageneration`, `size`, `updated`, `etag`. Prueba en vivo:

```
content_type: application/octet-stream  size: 116996
md5: JUdZWKOwzImt3nQPTsTI0A==  gen: 1504860713615867  meta: None
```

### 1.5 Subir un blob con content-type y metadatos personalizados

Firma real:

```python
Blob.upload_from_string(
    self, data, content_type='text/plain', client=None, predefined_acl=None,
    if_generation_match=None, if_generation_not_match=None,
    if_metageneration_match=None, if_metageneration_not_match=None,
    timeout=60, checksum='auto', retry=<DEFAULT_RETRY>, crc32c_checksum_value=None,
)
```

Los metadatos personalizados **se asignan al objeto `Blob` ANTES del upload**; la librería los incluye en el request de creación. Docstring real de `Blob._get_writable_metadata` (3.13.1), que enumera los campos escribibles en la creación:

```
acl, cacheControl, contentDisposition, contentEncoding, contentLanguage,
contentType, crc32c, customTime, md5Hash, metadata, name, retention, storageClass
```

Publicación de un módulo por el admin, con content-type, metadatos custom y creación no destructiva:

```python
import json
from google.cloud import storage
from google.api_core.exceptions import PreconditionFailed

client = storage.Client(project=PROJECT_ID, credentials=admin_creds)
bucket = client.bucket(BUCKET)

blob = bucket.blob("modulos/m3/v7.json")
blob.content_type = "application/json"
blob.cache_control = "public, max-age=300"
blob.metadata = {                    # ← valores se serializan SIEMPRE como str
    "telar-module-id": "m3",
    "telar-version": "7",
    "telar-sha256": sha256_hex,
}
try:
    blob.upload_from_string(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"),
        content_type="application/json",
        if_generation_match=0,       # 0 = "solo si el objeto NO existe" (create-only)
    )
except PreconditionFailed:
    ...  # esa versión del módulo ya estaba publicada: es inmutable, no se pisa
```

`if_generation_match=0` es la forma canónica de "crear pero nunca sobreescribir": encaja perfecto con el invariante de que `version` es monótona y una versión publicada es inmutable. Para el `catalogo.json` (que sí muta) se usa `if_generation_match=<generation_leída>` para un compare-and-swap optimista.

Setter real de `metadata` (fuente 3.13.1) — confirma la coerción a string y cómo se borra una clave:

```python
@metadata.setter
def metadata(self, value):
    """Update arbitrary/application specific metadata for the object.

    Values are stored to GCS as strings. To delete a key, set its value to
    None and call blob.patch().
    """
    if value is not None:
        value = {k: str(v) if v is not None else None for k, v in value.items()}
    self._patch_property("metadata", value)
```

Para modificar metadatos de un objeto ya subido, sin re-subir el contenido:

```python
blob.metadata = {"telar-version": "8"}
blob.patch(if_metageneration_match=blob.metageneration)
```

`Blob.patch(self, client=None, if_generation_match=None, if_generation_not_match=None, if_metageneration_match=None, if_metageneration_not_match=None, timeout=60, retry=<DEFAULT_RETRY>, override_unlocked_retention=False)`.

> Nota de diseño: los metadatos custom de GCS son cómodos pero **no son la fuente de verdad**. `version` y `checksum` deben vivir dentro del JSON del módulo (que es lo que se valida y lo que se persiste en SQLite). Los metadatos del blob sirven como índice barato para listar el catálogo sin descargar cada módulo, nada más.

### 1.6 Pasar una credencial OAuth **de usuario** (no service account)

El objeto es `google.oauth2.credentials.Credentials`. Firma real (google-auth 2.57.0):

```python
Credentials.__init__(
    self, token, refresh_token=None, id_token=None, token_uri=None,
    client_id=None, client_secret=None, scopes=None, default_scopes=None,
    quota_project_id=None, expiry=None, rapt_token=None, refresh_handler=None,
    enable_reauth_refresh=False, granted_scopes=None, trust_boundary=None,
    universe_domain='googleapis.com', account=None,
)
```

Se pasa igual que cualquier credencial:

```python
from google.cloud import storage
from google.oauth2.credentials import Credentials

creds = Credentials.from_authorized_user_info(json.loads(token_json), scopes=SCOPES)
client = storage.Client(project=PROJECT_ID, credentials=creds)
```

**Verificado empíricamente: `project` es OBLIGATORIO con credenciales de usuario.** Sin él:

```
OSError: Project was not passed and could not be determined from the environment.
```

(Las credenciales OAuth de usuario no llevan project id embebido, a diferencia de una service account.) Así que el `project_id` del admin debe ser configuración explícita del backend.

Persistencia del token. `Credentials.to_json()` (fuente real) determina exactamente **qué hay que guardar**:

```python
prep = {
    "token": self.token,
    "refresh_token": self.refresh_token,
    "token_uri": self.token_uri,
    "client_id": self.client_id,
    "client_secret": self.client_secret,
    "scopes": self.scopes,
    "rapt_token": self.rapt_token,
    "universe_domain": self._universe_domain,
    "account": self._account,
}
if self.expiry:
    prep["expiry"] = self.expiry.isoformat() + "Z"
```

Round-trip: `Credentials.from_authorized_user_info(info, scopes=None)` / `from_authorized_user_file(filename, scopes=None)`.

Refresco manual (el cliente lo hace solo cuando el token caduca, pero conviene poder forzarlo):

```python
from google.auth.transport.requests import Request
if not creds.valid:
    creds.refresh(Request())
# creds.valid / creds.expired / creds.token_state (TokenState.FRESH|STALE|INVALID)
```

Aviso: `refresh_token` y `client_secret` son **secretos** y no pueden ir a SQLite en claro sin una decisión consciente. Como es un token de admin en máquina de admin, lo razonable es un archivo fuera del repo con permisos 0600 o el keyring del SO, **nunca** el bucket ni la base compartida.

### 1.7 Excepciones: qué se lanza y de dónde se importa

Hay **tres** módulos en juego, y esto es lo que más se equivoca la gente.

**(a) `google.cloud.exceptions` — errores HTTP de la API.** Verificado con `is`: son **alias literales** de `google.api_core.exceptions` (`google.cloud.exceptions.NotFound is google.api_core.exceptions.NotFound → True`; `GoogleCloudError is GoogleAPICallError → True`). Nombres exportados y códigos reales:

| Clase | `code` | Clase | `code` |
|---|---|---|---|
| `BadRequest` | 400 | `PreconditionFailed` | 412 |
| `Unauthorized` | 401 | `RequestRangeNotSatisfiable` | 416 |
| `Forbidden` | 403 | `TooManyRequests` | 429 |
| `NotFound` | 404 | `InternalServerError` | 500 |
| `MethodNotAllowed` | 405 | `MethodNotImplemented` | 501 |
| `Conflict` | 409 | `BadGateway` | 502 |
| `LengthRequired` | 411 | `ServiceUnavailable` | 503 |
| | | `GatewayTimeout` | 504 |

Jerarquía: `GoogleAPIError` → `GoogleAPICallError` (= `GoogleCloudError`) → `ClientError` (4xx) / `ServerError` (5xx). Además `Redirection` (301/304/307/308) y `RetryError` (sin `code`, cuando se agotan los reintentos).

Import canónico:

```python
from google.cloud.exceptions import NotFound, Forbidden, PreconditionFailed, TooManyRequests
# equivalente: from google.api_core.exceptions import NotFound, ...
```

**(b) `google.cloud.storage.exceptions` — solo tres clases**, y ninguna es HTTP:

```python
InvalidPathError(Exception)   # "Raised when the provided path string is malformed."
InvalidResponse(...)          # "Error class for responses which are not in the correct state."
DataCorruption(...)           # "Error class for corrupt media transfers."  ← checksum falla
```

**(c) `google.auth.exceptions` — y aquí está el hallazgo no obvio.**

Prueba en vivo, cliente anónimo contra buckets **privados que sí existen** (`test`, `backup`, `data`):

```
test     -> google.auth.exceptions.InvalidOperation  code=None :: Anonymous credentials cannot be refreshed.
backup   -> google.auth.exceptions.InvalidOperation  code=None :: Anonymous credentials cannot be refreshed.
data     -> google.auth.exceptions.InvalidOperation  code=None :: Anonymous credentials cannot be refreshed.
google   -> google.api_core.exceptions.NotFound      code=404
```

Y un intento de escritura con cliente anónimo:

```
anon write -> google.auth.exceptions.InvalidOperation  code=None
```

Traducción: cuando GCS responde **401** a un cliente anónimo (bucket existe pero no es público), `google-auth` intenta refrescar la credencial anónima, no puede, y lo que sale por arriba **no es `Forbidden` ni `Unauthorized`, es `google.auth.exceptions.InvalidOperation`**. Es un `GoogleAuthError`, no un `GoogleAPICallError`, así que **no lo atrapa un `except GoogleCloudError`**.

Resumen del mapa de errores observado en vivo con cliente anónimo:

| Situación | Excepción real |
|---|---|
| Bucket inexistente | `google.api_core.exceptions.NotFound` (404) |
| Blob inexistente en bucket público | `google.api_core.exceptions.NotFound` (404) |
| Bucket existe pero **no es público** | `google.auth.exceptions.InvalidOperation` |
| Escritura con cliente anónimo | `google.auth.exceptions.InvalidOperation` (ni siquiera sale a la red) |
| `if_generation_match` no coincide | `google.api_core.exceptions.PreconditionFailed` (412) |
| Checksum del transporte no cuadra | `google.cloud.storage.exceptions.DataCorruption` |
| Rate limit | `google.api_core.exceptions.TooManyRequests` (429) |

El `except` mínimo correcto para el puerto de lectura:

```python
from google.api_core.exceptions import GoogleAPICallError, NotFound, RetryError
from google.auth.exceptions import GoogleAuthError          # ← imprescindible
from google.cloud.storage.exceptions import DataCorruption
from requests.exceptions import RequestException            # timeouts / DNS / TLS

CATALOGO_ERRORES = (GoogleAPICallError, GoogleAuthError, RetryError,
                    DataCorruption, RequestException)
```

Reintentos: `google.api_core.retry.Retry` y `google.cloud.storage.retry.DEFAULT_RETRY` / `ConditionalRetryPolicy`. Las lecturas ya reintentan por defecto (idempotentes); las escrituras solo si hay una precondición (`if_generation_match`), de ahí `ConditionalRetryPolicy`.

### 1.8 Alternativa sin SDK para el lado estudiante (a considerar)

El error 404 en vivo revela la URL exacta que usa el SDK:

```
404 GET https://storage.googleapis.com/storage/v1/b/google/o?maxResults=1&projection=noAcl&prettyPrint=false
```

Es decir, para un bucket **público** el lado estudiante puede hacer todo con dos GET sin credenciales, usando el `httpx` que el backend ya tiene:

- Listar: `GET https://storage.googleapis.com/storage/v1/b/<BUCKET>/o?prefix=modulos/&delimiter=/`
- Descargar: `GET https://storage.googleapis.com/<BUCKET>/<objeto>` (o `?alt=media` sobre la ruta v1)

Esto elimina `google-cloud-storage`, `requests`, `urllib3`, `google-auth` y `google-crc32c` del árbol de producción del backend del estudiante, y deja el SDK **solo** en la ruta de admin (que ya carga `google-auth-oauthlib` de todos modos). Dado que el `Protocol` del puerto abstrae ambos, es una decisión reversible: `GcsCatalogoPort` con dos implementaciones (`HttpxAnonimoAdapter` para leer, `GcsSdkAdapter` para escribir) y un `FakeCatalogoAdapter` en tests, replicando `DockerServicePort`.

---

## 2. OAuth 2.0 para apps de escritorio (solo el admin)

### 2.1 Endpoints exactos

Tomados **del discovery document en vivo** (`https://accounts.google.com/.well-known/openid-configuration`):

| Cosa | Valor |
|---|---|
| `authorization_endpoint` | `https://accounts.google.com/o/oauth2/v2/auth` |
| `token_endpoint` | `https://oauth2.googleapis.com/token` |
| `revocation_endpoint` | `https://oauth2.googleapis.com/revoke` |
| `device_authorization_endpoint` | `https://oauth2.googleapis.com/device/code` |
| `code_challenge_methods_supported` | `["plain", "S256"]` |

### 2.2 Flujo Authorization Code + PKCE con loopback (RFC 8252)

**Paso 1 — code verifier / challenge.** Doc oficial de Google: el verifier es "a high-entropy cryptographic random string using the unreserved characters `[A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"`, with a minimum length of 43 characters and a maximum length of 128 characters". El challenge S256 es "the Base64URL (with no padding) encoded SHA256 hash of the code verifier".

**Paso 2 — request de autorización** a `https://accounts.google.com/o/oauth2/v2/auth`:

| Parámetro | Obligatorio | Valor |
|---|---|---|
| `client_id` | sí | del cliente OAuth tipo **Desktop app** |
| `redirect_uri` | sí | `http://127.0.0.1:<puerto>/` |
| `response_type` | sí | `code` |
| `scope` | sí | lista separada por espacios |
| `code_challenge` | recomendado | base64url(sha256(verifier)) sin padding |
| `code_challenge_method` | recomendado | `S256` |
| `state` | recomendado | anti-CSRF |
| `access_type` | — | `offline` para recibir `refresh_token` |
| `prompt` | — | `consent` para forzar reemisión del `refresh_token` |
| `login_hint` | opcional | email del admin |

**Paso 3 — canje del código** en `POST https://oauth2.googleapis.com/token`:

`client_id`, `client_secret`, `code`, `code_verifier`, `grant_type=authorization_code`, `redirect_uri`.

> Sobre `client_secret`: para el tipo *Desktop app* Google emite un `client_secret`, pero RFC 8252 lo trata como **no confidencial** (va embebido en la app). `google-auth-oauthlib` lo exige en el `client_config`. No es un secreto que proteger criptográficamente; sí conviene no commitearlo, pero su filtración no compromete cuentas — el PKCE es lo que protege el intercambio.

**Redirect loopback.** Google acepta `http://127.0.0.1:port`, `http://[::1]:port` y también `localhost`. Por RFC 8252 §7.3, el servidor de autorización debe tratar el puerto como variable, así que **no hay que registrar cada puerto**: se puede abrir uno efímero (`port=0`) y construir el `redirect_uri` con el puerto que el SO asignó. Preferir `127.0.0.1` sobre `localhost` (evita la ambigüedad IPv4/IPv6 de la resolución de `localhost`). Esto encaja con la restricción "puertos ligados a 127.0.0.1" del repo.

### 2.3 `google-auth-oauthlib`: PKCE automático, y sí, es S256

Fuente real de `Flow.authorization_url` en 1.4.1 — **el PKCE ya viene hecho, no hay que implementarlo a mano**:

```python
def authorization_url(self, **kwargs):
    kwargs.setdefault("access_type", "offline")
    if self.code_verifier is None and self.autogenerate_code_verifier:
        chars = ascii_letters + digits + "-._~"
        rnd = SystemRandom()
        random_verifier = [rnd.choice(chars) for _ in range(0, 128)]
        self.code_verifier = "".join(random_verifier)

    if self.code_verifier:
        code_hash = hashlib.sha256()
        code_hash.update(str.encode(self.code_verifier))
        unencoded_challenge = code_hash.digest()
        b64_challenge = urlsafe_b64encode(unencoded_challenge)
        code_challenge = b64_challenge.decode().split("=")[0]
        kwargs.setdefault("code_challenge", code_challenge)
        kwargs.setdefault("code_challenge_method", "S256")
    url, state = sel...
```

Verifier de 128 chars sobre el alfabeto unreserved, `SystemRandom` (CSPRNG), challenge S256 con padding stripped. `access_type=offline` por defecto → siempre pide `refresh_token`.

Firmas reales:

```python
Flow.__init__(self, oauth2session, client_type, client_config,
              redirect_uri=None, code_verifier=None, autogenerate_code_verifier=True)

InstalledAppFlow.run_local_server(
    self, host='localhost', bind_addr=None, port=8080,
    authorization_prompt_message='Please visit this URL to authorize this application: {url}',
    success_message='The authentication flow has completed. You may close this window.',
    open_browser=True, redirect_uri_trailing_slash=True,
    timeout_seconds=None, token_audience=None, browser=None, **kwargs,
)
```

Cuerpo real que confirma el puerto efímero (lee `local_server.server_port` **después** de crear el servidor):

```python
local_server = wsgiref.simple_server.make_server(
    bind_addr or host, port, wsgi_app,
    server_class=_ExclusiveWSGIServer, handler_class=_WSGIRequestHandler,
)
try:
    redirect_uri_format = ("http://{}:{}/" if redirect_uri_trailing_slash else "http://{}:{}")
    self.redirect_uri = redirect_uri_format.format(host, local_server.server_port)
    auth_url, _ = self.authorization_url(**kwargs)
    ...
    local_server.timeout = timeout_seconds
    local_server.handle_request()
```

Uso concreto para Telar (admin):

```python
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/devstorage.read_write"]

CLIENT_CONFIG = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, scopes=SCOPES)
creds = flow.run_local_server(
    host="127.0.0.1",     # loopback explícito, no 'localhost'
    port=0,               # puerto efímero: no hay que registrarlo en la consola
    open_browser=True,
    timeout_seconds=300,  # sin esto, handle_request() bloquea para siempre
    prompt="consent",     # **kwargs → authorization_url(): fuerza refresh_token nuevo
)
guardar_token(creds.to_json())   # fuera del repo, 0600
```

`timeout_seconds=None` es el default y significa **bloqueo indefinido**; en un backend hay que ponerlo sí o sí. Si expira, se levanta `WSGITimeoutError`.

`flow.credentials` devuelve un `google.oauth2.credentials.Credentials` listo para pasarle a `storage.Client(project=..., credentials=...)`.

### 2.4 Scopes de GCS (URLs completas)

De `cloud.google.com/storage/docs/oauth-scopes`, verbatim:

| Tipo | Descripción oficial | URL |
|---|---|---|
| read-only | "Only allows access to read data, including listing buckets." | `https://www.googleapis.com/auth/devstorage.read_only` |
| read-write | "Allows access to read and change data, but not metadata like IAM policies." | `https://www.googleapis.com/auth/devstorage.read_write` |
| full-control | "Allows full control over data, including the ability to modify IAM policies." | `https://www.googleapis.com/auth/devstorage.full_control` |
| cloud-platform.read-only | "For Cloud Storage, this is the same as `devstorage.read-only`." | `https://www.googleapis.com/auth/cloud-platform.read-only` |
| cloud-platform | "For Cloud Storage, this is the same as `devstorage.full-control`." | `https://www.googleapis.com/auth/cloud-platform` |

Para Telar: el admin solo necesita **`devstorage.read_write`** (subir y sobreescribir objetos). `full_control` añade modificar políticas IAM — no hace falta y empeora cualquier revisión futura. El estudiante **no necesita ningún scope** porque lee anónimo.

### 2.5 Refresco de token: qué se guarda

`POST https://oauth2.googleapis.com/token` con `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`. Devuelve un `access_token` nuevo (~1 h) y **no** un `refresh_token` nuevo.

Lo que hay que persistir es exactamente el JSON de `to_json()` (§1.6): `token`, `refresh_token`, `token_uri`, `client_id`, `client_secret`, `scopes`, `expiry`, `universe_domain`, y opcionalmente `rapt_token`/`account`. El campo que **realmente** hay que preservar entre sesiones es `refresh_token`; el resto se puede reconstruir salvo `expiry` (que solo evita un refresh innecesario).

Nota crítica: Google **solo devuelve `refresh_token` en el primer consentimiento** de una combinación cliente+usuario, salvo que mandes `prompt=consent`. Si se pierde el archivo de token, hay que rehacer el flujo con `prompt=consent` o revocar en `https://myaccount.google.com/permissions`.

Motivos documentados de invalidación del `refresh_token`: revocación del usuario, 6 meses sin uso, cambio de contraseña (para scopes de Gmail), superar el límite de tokens vivos por cliente/usuario, y **7 días si la app está en modo Testing** (§2.7). Un `refresh_token` inválido se manifiesta como `invalid_grant` en el token endpoint → `google.auth.exceptions.RefreshError`.

### 2.6 Flujo 'oob' — **CONFIRMADO: descontinuado y bloqueado**

De la *OOB Migration Guide* oficial de Google, fechas verbatim:

- **28 feb 2022** — bloqueado el uso nuevo del flujo OOB.
- **5 sep 2022** — mensaje de advertencia al usuario en requests no conformes.
- **3 oct 2022** — OOB deprecado para clientes creados antes del 28 feb 2022.
- **31 ene 2023** — **todos** los clientes bloqueados, incluidos los exentos.

El error hoy es un `invalid_request` / pantalla "app bloqueada" mostrando el email de soporte del consent screen. La migración recomendada para desktop es explícitamente "the loopback IP address (`localhost` or `127.0.0.1`) flow".

Corroboración en la propia librería: **verificado que `google_auth_oauthlib.flow.InstalledAppFlow.run_console` ya no existe** (`hasattr(...) → False` en 1.4.1). Era el método que implementaba OOB; fue eliminado.

**Confirmación adicional relevante:** existe una deprecación *distinta* del **loopback**, que a menudo se confunde con ésta. De la *Loopback IP Address flow Migration Guide*: "The loopback IP address flow is being deprecated for iOS, Android, and Chrome OAuth client types" y "will continue to be supported on **desktop apps**". Fechas: 14 mar 2022 (clientes nuevos bloqueados), 31 ago 2022 (Android/Chrome/iOS existentes bloqueados), 21 oct 2022 (todos). **El tipo de cliente "Desktop app" NO está afectado** — el loopback sigue siendo el camino correcto y soportado para Telar.

### 2.7 Consent screen en modo Testing — **CONFIRMADO el tope de 100**

De `support.google.com/cloud/answer/15549945` (Manage App Audience), verbatim:

> "Projects configured with a publishing status of **Testing** are limited to up to 100 test users listed in the OAuth consent screen."

> "Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an `offline` access type and receives a refresh token, that token will also expire."

Es decir: **100 test users** confirmado, **y además** el `refresh_token` del admin caducará **cada 7 días** mientras la app esté en Testing. Esto último es el problema práctico real para Telar: el admin tendría que re-autenticarse semanalmente. Para una tesis es tolerable (y hasta honesto documentarlo), pero conviene que el código lo maneje: capturar `RefreshError` / `invalid_grant` y relanzar `run_local_server` en vez de romper.

### 2.8 `devstorage.read_only` como scope "sensible" — **NO CONFIRMADO**

Esto no lo pude confirmar y **no lo voy a afirmar**. Lo que sí encontré:

- La página oficial `developers.google.com/identity/protocols/oauth2/scopes` lista los tres scopes `devstorage.*` bajo "Cloud Storage JSON API v1" y **no los marca** como *sensitive* ni *restricted*. La página no muestra ningún indicador para ellos.
- La política oficial es: "Sensitive scopes require review by Google and have a *sensitive* indicator on the Google Cloud Console's OAuth consent screen configuration page" y "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process". La clasificación autoritativa se ve **en la consola**, no en una lista publicada.
- La página de *sensitive scope verification* da como ejemplos Calendar, Contacts y YouTube; **no menciona en absoluto** los scopes de Google Cloud Platform.

Además, hay excepciones documentadas a la verificación que aplican directamente al caso de Telar: **uso personal** ("apps used only by yourself or a small circle of people you know personally"), **desarrollo/testing/staging** con publishing status Testing, y **uso interno** dentro de una organización Workspace/Cloud Identity.

Conclusión operativa (no una afirmación sobre la clasificación del scope): dado que **solo el admin** hace OAuth y el estudiante lee anónimo, Telar cae de lleno en la excepción de uso personal / testing. El proyecto puede quedarse en modo Testing con el admin como único test user y nunca necesitar verificación — pagando el precio del refresh token de 7 días. Si algún día se quisiera publicar, ahí sí habría que mirar la etiqueta que la consola le ponga a `devstorage.read_write`.

---

## 3. Aterrizaje en el puerto de Telar (bosquejo, no código de repo)

```python
from typing import Protocol, Sequence
from dataclasses import dataclass

@dataclass(frozen=True)
class ObjetoRemoto:
    nombre: str
    generation: int          # ancla de versión exacta para la descarga
    tamano: int
    content_type: str | None
    metadatos: dict[str, str]

class CatalogoRemotoPort(Protocol):
    def listar(self, prefijo: str) -> Sequence[ObjetoRemoto]: ...
    def descargar_texto(self, nombre: str, *, generation: int | None = None,
                        tamano_max: int) -> str: ...

class PublicadorRemotoPort(Protocol):     # solo admin
    def publicar(self, nombre: str, cuerpo: bytes, *,
                 content_type: str, metadatos: dict[str, str],
                 solo_si_no_existe: bool = True) -> int: ...
```

Puntos que la investigación deja fijados:

1. `listar` usa `client.bucket(...)` + `list_blobs(prefix=..., delimiter=...)`, nunca `get_bucket`.
2. `descargar_texto` traduce `if_generation_match=generation` y **comprueba `tamano` antes** de traer bytes.
3. La traducción de excepciones debe cubrir `GoogleAPICallError`, **`GoogleAuthError`** (el caso del bucket privado que devuelve `InvalidOperation`, no `Forbidden`), `RetryError`, `DataCorruption` y `RequestException`. Un `except GoogleCloudError` solo **no basta**.
4. `publicar` usa `if_generation_match=0` para versiones inmutables y `if_generation_match=<gen>` (CAS) para el índice del catálogo.
5. El fake para tests es un dict en memoria detrás del mismo `Protocol` — idéntico al patrón de `DockerServicePort`. Ningún test debe tocar la red.

---

## 4. Incertidumbres — lo que NO pude confirmar

1. **Clasificación *sensitive* de `devstorage.read_only` / `read_write`.** La lista pública de scopes de Google **no los marca** como sensibles, y la doc de verificación no menciona los scopes de GCP. Google dice que la categoría se ve en la consola de Cloud al añadir el scope. **No puedo confirmar ni desmentir** la afirmación; solo puedo decir que la fuente pública no la respalda. Verificación definitiva: entrar a la consola del proyecto, "OAuth consent screen → Data access → Add scopes", y leer la columna de categoría. Es un chequeo de 30 segundos y da la respuesta autoritativa.
2. **Fecha de release exacta de `google-cloud-storage` 3.13.1.** El JSON de PyPI la trae pero no la pude extraer del fetch. La versión (3.13.1), el `requires_python` (`>=3.10`) y las dependencias sí están confirmados.
3. **Comportamiento del cliente anónimo contra un bucket que existe, es privado, pero cuya *existencia* es pública.** Probé con `test`, `backup`, `data` y siempre salió `InvalidOperation`; no pude construir un caso controlado que devolviera `Forbidden` (403) limpio. Mi lectura es que GCS devuelve 401 (no 403) a peticiones sin credencial, y que un `Forbidden` solo aparecería con una credencial válida pero sin permiso — o sea, en la ruta del admin, no en la del estudiante. **No lo verifiqué.** El adaptador debe manejar ambos igualmente.
4. **Si el `refresh_token` de 7 días en modo Testing aplica a proyectos con consent screen tipo "Internal"** (Workspace/Cloud Identity). La doc habla de "test users", que es una figura del modo External+Testing. Si la universidad tiene Workspace y el proyecto puede ser Internal, el problema de los 7 días probablemente desaparece — **pero no lo pude confirmar**.
5. **Límite exacto de refresh tokens vivos por combinación client/user.** Google documenta que existen dos límites ("one limit per client/user combination, and another per user across all clients") pero no publica los números en la página que consulté.
6. **`match_glob` con cliente anónimo.** Está en la firma de `list_blobs` de 3.13.1 y documentado en la API v1, pero **no lo probé en vivo**; solo probé `prefix` y `delimiter`.

---

**Fuentes**

- [Class Client — Cloud Storage Python](https://cloud.google.com/python/docs/reference/storage/latest/google.cloud.storage.client.Client)
- [Class Blob — Cloud Storage Python](https://cloud.google.com/python/docs/reference/storage/latest/google.cloud.storage.blob.Blob)
- [googleapis/python-storage (fuente)](https://github.com/googleapis/python-storage)
- [google-cloud-storage en PyPI](https://pypi.org/project/google-cloud-storage/)
- [google.api_core.exceptions (fuente)](https://googleapis.dev/python/google-api-core/latest/_modules/google/api_core/exceptions.html)
- [google.oauth2.credentials — google-auth](https://googleapis.dev/python/google-auth/latest/reference/google.oauth2.credentials.html)
- [google_auth_oauthlib.flow](https://google-auth-oauthlib.readthedocs.io/en/latest/reference/google_auth_oauthlib.flow.html)
- [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OpenID discovery document](https://accounts.google.com/.well-known/openid-configuration)
- [OOB flow Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)
- [Loopback IP Address flow Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [Cloud Storage OAuth 2.0 scopes](https://cloud.google.com/storage/docs/oauth-scopes)
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
- [Manage App Audience (Testing / 100 test users / 7 días)](https://support.google.com/cloud/answer/15549945?hl=en)
- [OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073?hl=en)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)