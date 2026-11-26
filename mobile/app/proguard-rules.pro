# Gson llena y lee los DTO por reflexión, usando el NOMBRE de cada campo. Si R8 los renombra
# (lo hacía: en el build de release `LoginRequest.email` salía como `a`), el JSON que se manda
# no coincide con el contrato y el servidor responde 400 (por ejemplo, el login o el lote de
# offline-sync, que rechaza cualquier campo que no esté en el contrato).
-keep class com.udem.retaildecision.data.remote.dto.** { *; }

# Contenido de cada captura guardado como JSON en Room (`payloadJson`). Si sus campos cambiaran de
# nombre entre versiones, las capturas ya guardadas en el teléfono dejarían de leerse.
-keep class com.udem.retaildecision.data.repository.ObservacionPayload { *; }

# Tipos genéricos (PageResponse<T>, List<T>) que Gson necesita ver en tiempo de ejecución.
-keepattributes Signature, *Annotation*, InnerClasses, EnclosingMethod
