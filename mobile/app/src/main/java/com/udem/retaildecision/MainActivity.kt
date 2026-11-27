package com.udem.retaildecision

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.udem.retaildecision.data.local.AppDatabase
import com.udem.retaildecision.data.local.CatalogCache
import com.udem.retaildecision.data.local.ConnectivityObserver
import com.udem.retaildecision.data.local.UltimaTiendaPorUsuario
import com.udem.retaildecision.data.location.LocationProvider
import com.udem.retaildecision.data.remote.ApiClient
import com.udem.retaildecision.data.repository.AuthRepository
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.ObservationRepository
import com.udem.retaildecision.data.repository.PriceReviewRepository
import com.udem.retaildecision.data.repository.PricingRepository
import com.udem.retaildecision.data.repository.ProposalsRepository
import com.udem.retaildecision.data.repository.ZoneInsightsRepository
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.sync.SyncScheduler
import com.udem.retaildecision.ui.catalog.CatalogScreen
import com.udem.retaildecision.ui.catalog.CatalogViewModel
import com.udem.retaildecision.ui.catalog.CatalogViewModelFactory
import com.udem.retaildecision.ui.home.HomeScreen
import com.udem.retaildecision.ui.home.HomeViewModel
import com.udem.retaildecision.ui.home.HomeViewModelFactory
import com.udem.retaildecision.ui.home.ROLES_CONSULTAN_DECISIONES
import com.udem.retaildecision.ui.home.ROLES_VEN_PRECIOS
import com.udem.retaildecision.ui.home.SectionPlaceholderScreen
import com.udem.retaildecision.ui.login.LoginScreen
import com.udem.retaildecision.ui.login.LoginViewModel
import com.udem.retaildecision.ui.login.LoginViewModelFactory
import com.udem.retaildecision.ui.observations.ObservationsScreen
import com.udem.retaildecision.ui.observations.ObservationsViewModel
import com.udem.retaildecision.ui.observations.ObservationsViewModelFactory
import com.udem.retaildecision.ui.observations.Preseleccion
import com.udem.retaildecision.ui.pricing.PricingScreen
import com.udem.retaildecision.ui.pricing.PricingViewModel
import com.udem.retaildecision.ui.pricing.PricingViewModelFactory
import com.udem.retaildecision.ui.products.ProductProposalScreen
import com.udem.retaildecision.ui.products.ProductProposalViewModel
import com.udem.retaildecision.ui.products.ProductProposalViewModelFactory
import com.udem.retaildecision.ui.proposals.ProposalsScreen
import com.udem.retaildecision.ui.proposals.ProposalsViewModel
import com.udem.retaildecision.ui.proposals.ProposalsViewModelFactory
import com.udem.retaildecision.ui.review.PriceReviewScreen
import com.udem.retaildecision.ui.review.PriceReviewViewModel
import com.udem.retaildecision.ui.review.PriceReviewViewModelFactory
import com.udem.retaildecision.ui.review.ProductReviewScreen
import com.udem.retaildecision.ui.review.ProductReviewViewModel
import com.udem.retaildecision.ui.review.ProductReviewViewModelFactory
import com.udem.retaildecision.ui.scanner.ScannerScreen
import com.udem.retaildecision.ui.scanner.ScannerViewModel
import com.udem.retaildecision.ui.scanner.ScannerViewModelFactory
import com.udem.retaildecision.ui.theme.RetailTheme
import com.udem.retaildecision.ui.zones.CargadorDetalleZona
import com.udem.retaildecision.ui.zones.ZoneDetailScreen
import com.udem.retaildecision.ui.zones.ZoneDetailViewModel
import com.udem.retaildecision.ui.zones.ZoneDetailViewModelFactory
import com.udem.retaildecision.ui.zones.permisosZona

/** Ruta del login. `expirada=true` hace que el login muestre "Tu sesión expiró". */
private const val LOGIN_ROUTE = "login?expirada={expirada}"

/**
 * Un solo Activity para toda la app (patrón "single-activity"); las
 * pantallas son Composables manejados por Navigation Compose, no Activities
 * separadas. Las dependencias se arman aquí a mano (sin Hilt) y se pasan
 * hacia abajo por constructor.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = application as RetailDecisionApp
        val authRepository = AuthRepository(ApiClient.authApi, app.tokenManager)
        val catalogRepository = CatalogRepository(ApiClient.catalogApi, onSesionExpirada = ApiClient::expirarSesion)
        val pricingRepository = PricingRepository(ApiClient.pricingApi, onSesionExpirada = ApiClient::expirarSesion)
        val zoneInsightsRepository = ZoneInsightsRepository(
            ApiClient.segmentationApi,
            ApiClient.availabilityApi,
            onSesionExpirada = ApiClient::expirarSesion,
        )
        val connectivityObserver = ConnectivityObserver(applicationContext)
        val proposalsRepository = ProposalsRepository(ApiClient.pricingApi, onSesionExpirada = ApiClient::expirarSesion)
        val observationRepository = ObservationRepository(
            AppDatabase.getInstance(applicationContext).pendingVisitDao(),
            ApiClient.pricingApi,
            usuarioActual = app.tokenManager::getUserId,
            onSesionExpirada = ApiClient::expirarSesion,
        )
        val priceReviewRepository = PriceReviewRepository(ApiClient.pricingApi, onSesionExpirada = ApiClient::expirarSesion)
        val locationProvider = LocationProvider(applicationContext)
        val catalogCache = CatalogCache(applicationContext)
        val ultimaTienda = UltimaTiendaPorUsuario.enTelefono(applicationContext)
        val usuarioActual: () -> String? = app.tokenManager::getUserId
        val programarEnvio: () -> Unit = { SyncScheduler.programar(applicationContext) }

        // Si quedaron capturas sin enviar (por ejemplo, se guardaron sin internet), se piden enviar al abrir la app.
        if (authRepository.isLoggedIn()) programarEnvio()

        setContent {
            RetailTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    RetailDecisionNavHost(
                        authRepository = authRepository,
                        catalogRepository = catalogRepository,
                        pricingRepository = pricingRepository,
                        zoneInsightsRepository = zoneInsightsRepository,
                        proposalsRepository = proposalsRepository,
                        priceReviewRepository = priceReviewRepository,
                        observationRepository = observationRepository,
                        locationProvider = locationProvider,
                        catalogCache = catalogCache,
                        ultimaTienda = ultimaTienda,
                        usuarioActual = usuarioActual,
                        programarEnvio = programarEnvio,
                        connectivityObserver = connectivityObserver,
                        startLoggedIn = authRepository.isLoggedIn(),
                    )
                }
            }
        }
    }
}

@Composable
private fun RetailDecisionNavHost(
    authRepository: AuthRepository,
    catalogRepository: CatalogRepository,
    pricingRepository: PricingRepository,
    zoneInsightsRepository: ZoneInsightsRepository,
    proposalsRepository: ProposalsRepository,
    priceReviewRepository: PriceReviewRepository,
    observationRepository: ObservationRepository,
    locationProvider: LocationProvider,
    catalogCache: CatalogCache,
    ultimaTienda: UltimaTiendaPorUsuario,
    usuarioActual: () -> String?,
    programarEnvio: () -> Unit,
    connectivityObserver: ConnectivityObserver,
    startLoggedIn: Boolean,
) {
    val navController = rememberNavController()
    val startDestination = if (startLoggedIn) "home" else LOGIN_ROUTE

    // Si la sesión muere en cualquier pantalla, se regresa al login con el aviso.
    LaunchedEffect(Unit) {
        ApiClient.sessionExpired.collect {
            val ruta = navController.currentDestination?.route.orEmpty()
            if (!ruta.startsWith("login")) {
                navController.navigate("login?expirada=true") { popUpTo(0) { inclusive = true } }
            }
        }
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable(
            route = LOGIN_ROUTE,
            arguments = listOf(navArgument("expirada") { type = NavType.BoolType; defaultValue = false }),
        ) { entry ->
            val expirada = entry.arguments?.getBoolean("expirada") ?: false
            val viewModel: LoginViewModel = viewModel(factory = LoginViewModelFactory(authRepository))
            LoginScreen(
                viewModel = viewModel,
                aviso = if (expirada) "Tu sesión expiró. Inicia sesión de nuevo." else null,
                onLoginSuccess = {
                    // Lo que se capturó sin sesión (o antes de que expirara) sale en cuanto haya red.
                    programarEnvio()
                    navController.navigate("home") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
        composable("home") {
            val viewModel: HomeViewModel =
                viewModel(factory = HomeViewModelFactory(authRepository, connectivityObserver))
            HomeScreen(
                viewModel = viewModel,
                onOpenSection = { id -> navController.navigate("seccion/$id") },
                onLoggedOut = {
                    navController.navigate("login?expirada=false") {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
        composable(
            // Los opcionales solo los usa "visitas": `tiendaId` llega desde "Capturar aquí" del Detalle de zona;
            // `presentacionId`, `tipo` y `codigo`, desde los botones de captura del escáner.
            route = "seccion/{id}?tiendaId={tiendaId}&presentacionId={presentacionId}&tipo={tipo}&codigo={codigo}",
            arguments = listOf(
                navArgument("id") { type = NavType.StringType },
                navArgument("tiendaId") { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument("presentacionId") { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument("tipo") { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument("codigo") { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            val id = entry.arguments?.getString("id")
            when (id) {
                // "catalogo" y "zonas" son la misma pantalla; solo cambia la pestaña con la que abre.
                "catalogo", "zonas" -> {
                    val rol = authRepository.currentRole()
                    val permisos = permisosZona(rol)
                    val viewModel: CatalogViewModel = viewModel(
                        factory = CatalogViewModelFactory(
                            catalogRepository,
                            cache = catalogCache,
                            // GET /v1/stores: 6 internos + Investigador (D-28). Al Proveedor le da 403.
                            cargarTiendas = rol in Rol.INTERNOS || rol == Rol.INVESTIGADOR,
                            // income-segmentation: solo los 6 internos. Al Investigador ni se le pide (D-28).
                            clasificaciones = if (permisos.veIngreso) {
                                { zoneInsightsRepository.clasificacionesVigentes() }
                            } else null,
                        ),
                    )
                    CatalogScreen(
                        viewModel = viewModel,
                        pestanaInicial = if (id == "zonas") 1 else 0,
                        onAbrirZona = { zonaId -> navController.navigate("zona/$zonaId") },
                        onBack = { navController.popBackStack() },
                    )
                }
                "precios" -> {
                    val viewModel: PricingViewModel =
                        viewModel(factory = PricingViewModelFactory(catalogRepository, pricingRepository))
                    PricingScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "escaner" -> {
                    // El Investigador de mercado identifica productos, pero no lee precios (D-28).
                    val rol = authRepository.currentRole()
                    val puedeVerPrecios = rol in ROLES_VEN_PRECIOS
                    val viewModel: ScannerViewModel = viewModel(
                        factory = ScannerViewModelFactory(
                            catalogRepository, pricingRepository, puedeVerPrecios,
                            // Botones "Capturar precio" / "Capturar existencia": solo los tipos que el rol puede enviar.
                            tiposCaptura = TipoCaptura.permitidosPara(rol),
                            cache = catalogCache,
                        ),
                    )
                    ScannerScreen(
                        viewModel = viewModel,
                        onCapturar = { tipo, presentacionId, codigo ->
                            navController.navigate(
                                "seccion/visitas?presentacionId=${Uri.encode(presentacionId)}" +
                                        "&tipo=${Uri.encode(tipo)}&codigo=${Uri.encode(codigo)}",
                            )
                        },
                        onBack = { navController.popBackStack() },
                    )
                }
                "visitas" -> {
                    val rol = authRepository.currentRole()
                    val viewModel: ObservationsViewModel = viewModel(
                        factory = ObservationsViewModelFactory(
                            catalogRepository, observationRepository, locationProvider, catalogCache, programarEnvio,
                            tiposPermitidos = TipoCaptura.permitidosPara(rol),
                            puedeConsultarDecisiones = rol in ROLES_CONSULTAN_DECISIONES,
                            conectividad = connectivityObserver.observe(),
                            preseleccion = Preseleccion(
                                tiendaId = entry.arguments?.getString("tiendaId"),
                                presentacionId = entry.arguments?.getString("presentacionId"),
                                tipo = entry.arguments?.getString("tipo"),
                                codigo = entry.arguments?.getString("codigo"),
                            ),
                            ultimaTienda = ultimaTienda,
                            usuarioActual = usuarioActual,
                        ),
                    )
                    ObservationsScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "propuestas" -> {
                    val viewModel: ProposalsViewModel =
                        viewModel(factory = ProposalsViewModelFactory(catalogRepository, proposalsRepository))
                    ProposalsScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "comparar_precios" -> {
                    // Proveedor: solo comparación de sus productos activos (el historial es de los perfiles internos).
                    val viewModel: PricingViewModel = viewModel(
                        key = "comparar_precios",
                        factory = PricingViewModelFactory(catalogRepository, pricingRepository, soloComparacion = true),
                    )
                    PricingScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "proponer_producto" -> {
                    val viewModel: ProductProposalViewModel =
                        viewModel(factory = ProductProposalViewModelFactory(catalogRepository))
                    ProductProposalScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "revision_precios" -> {
                    // Solo el Responsable de precios resuelve (D1); Administrador y Auditor ven la cola sin botones.
                    val puedeResolver = authRepository.currentRole() == Rol.RESPONSABLE_PRECIOS
                    val viewModel: PriceReviewViewModel =
                        viewModel(factory = PriceReviewViewModelFactory(priceReviewRepository, puedeResolver))
                    PriceReviewScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "productos_pendientes" -> {
                    // Solo el Gerente de categoría resuelve (D-08); Administrador y Auditor leen.
                    val puedeResolver = authRepository.currentRole() == Rol.GERENTE_CATEGORIA
                    val viewModel: ProductReviewViewModel =
                        viewModel(factory = ProductReviewViewModelFactory(catalogRepository, puedeResolver))
                    ProductReviewScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                else -> SectionPlaceholderScreen(
                    seccionId = id,
                    onBack = { navController.popBackStack() },
                )
            }
        }
        composable(
            route = "zona/{zonaId}",
            arguments = listOf(navArgument("zonaId") { type = NavType.StringType }),
        ) { entry ->
            val zonaId = entry.arguments?.getString("zonaId").orEmpty()
            val permisos = permisosZona(authRepository.currentRole())
            val viewModel: ZoneDetailViewModel = viewModel(
                factory = ZoneDetailViewModelFactory(
                    zonaId = zonaId,
                    // La lista guarda las zonas en el teléfono antes de pintarse, así que aquí siempre está.
                    zona = CatalogViewModel.zonaGuardada(catalogCache, zonaId),
                    permisos = permisos,
                    cargador = CargadorDetalleZona(
                        permisos = permisos,
                        tiendasRemotas = { catalogRepository.tiendas(zonaId = it) },
                        pedirClasificacion = { zoneInsightsRepository.clasificacion(it) },
                        pedirCobertura = { zoneInsightsRepository.cobertura(it) },
                        cache = catalogCache,
                    ),
                ),
            )
            ZoneDetailScreen(
                viewModel = viewModel,
                onCapturarEn = { tiendaId -> navController.navigate("seccion/visitas?tiendaId=$tiendaId") },
                onBack = { navController.popBackStack() },
            )
        }
    }
}