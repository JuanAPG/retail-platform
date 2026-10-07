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
import com.udem.retaildecision.data.local.ConnectivityObserver
import com.udem.retaildecision.data.remote.ApiClient
import com.udem.retaildecision.data.repository.AuthRepository
import com.udem.retaildecision.data.repository.CatalogRepository
import com.udem.retaildecision.data.repository.PricingRepository
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
import com.udem.retaildecision.ui.pricing.PricingScreen
import com.udem.retaildecision.ui.pricing.PricingViewModel
import com.udem.retaildecision.ui.pricing.PricingViewModelFactory
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

        setContent {
            RetailTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    RetailDecisionNavHost(
                        authRepository = authRepository,
                        catalogRepository = catalogRepository,
                        pricingRepository = pricingRepository,
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
                else -> SectionPlaceholderScreen(
                    seccionId = id,
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}