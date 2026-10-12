package com.udem.retaildecision

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
import com.udem.retaildecision.data.location.LocationProvider
import com.udem.retaildecision.data.remote.ApiClient
import com.udem.retaildecision.data.repository.AuthRepository
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.ObservationRepository
import com.udem.retaildecision.data.repository.PriceReviewRepository
import com.udem.retaildecision.data.repository.PricingRepository
import com.udem.retaildecision.data.repository.ProposalsRepository
import com.udem.retaildecision.data.model.Rol
import com.udem.retaildecision.data.sync.SyncScheduler
import com.udem.retaildecision.ui.catalog.CatalogScreen
import com.udem.retaildecision.ui.catalog.CatalogViewModel
import com.udem.retaildecision.ui.catalog.CatalogViewModelFactory
import com.udem.retaildecision.ui.home.HomeScreen
import com.udem.retaildecision.ui.home.HomeViewModel
import com.udem.retaildecision.ui.home.HomeViewModelFactory
import com.udem.retaildecision.ui.home.SectionPlaceholderScreen
import com.udem.retaildecision.ui.login.LoginScreen
import com.udem.retaildecision.ui.login.LoginViewModel
import com.udem.retaildecision.ui.login.LoginViewModelFactory
import com.udem.retaildecision.ui.observations.ObservationsScreen
import com.udem.retaildecision.ui.observations.ObservationsViewModel
import com.udem.retaildecision.ui.observations.ObservationsViewModelFactory
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
        val connectivityObserver = ConnectivityObserver(applicationContext)
        val proposalsRepository = ProposalsRepository(ApiClient.pricingApi, onSesionExpirada = ApiClient::expirarSesion)
        val observationRepository = ObservationRepository(
            AppDatabase.getInstance(applicationContext).pendingVisitDao(),
            ApiClient.pricingApi,
            onSesionExpirada = ApiClient::expirarSesion,
        )
        val priceReviewRepository = PriceReviewRepository(ApiClient.pricingApi, onSesionExpirada = ApiClient::expirarSesion)
        val locationProvider = LocationProvider(applicationContext)
        val catalogCache = CatalogCache(applicationContext)
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
                        proposalsRepository = proposalsRepository,
                        priceReviewRepository = priceReviewRepository,
                        observationRepository = observationRepository,
                        locationProvider = locationProvider,
                        catalogCache = catalogCache,
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
    proposalsRepository: ProposalsRepository,
    priceReviewRepository: PriceReviewRepository,
    observationRepository: ObservationRepository,
    locationProvider: LocationProvider,
    catalogCache: CatalogCache,
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
            route = "seccion/{id}",
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("id")
            when (id) {
                // "catalogo" y "zonas" son la misma pantalla; solo cambia la pestaña con la que abre.
                "catalogo", "zonas" -> {
                    val viewModel: CatalogViewModel =
                        viewModel(factory = CatalogViewModelFactory(catalogRepository))
                    CatalogScreen(
                        viewModel = viewModel,
                        pestanaInicial = if (id == "zonas") 1 else 0,
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
                    val viewModel: ScannerViewModel =
                        viewModel(factory = ScannerViewModelFactory(catalogRepository, pricingRepository))
                    ScannerScreen(
                        viewModel = viewModel,
                        onBack = { navController.popBackStack() },
                    )
                }
                "visitas" -> {
                    val viewModel: ObservationsViewModel = viewModel(
                        factory = ObservationsViewModelFactory(
                            catalogRepository, observationRepository, locationProvider, catalogCache, programarEnvio,
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
    }
}