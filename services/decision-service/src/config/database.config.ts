import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { AccessibilityZoneEntity } from '../entities/accessibility-zone.entity';
import { AccessibilityWeightEntity } from '../entities/accessibility-weight.entity';
import { AccessibilityComponentEntity } from '../entities/accessibility-component.entity';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { Recommendation } from '../entities/recommendation.entity';
import { RecommendationEvidence } from '../entities/recommendation-evidence.entity';

/**
 * decision-service (M12 Accessibility + M13 Simulation + M14 Recommendations).
 *
 * Solo registra las entidades que ESTE servicio escribe. El resto de la
 * información que necesita (zonas, precios, productos, transacciones...)
 * la lee con SQL crudo vía DataSource directo a las tablas/vistas
 * compartidas -- nunca con un repositorio de una entidad que pertenece a
 * otro servicio (esa es la frontera entre "leer" y "poseer" una tabla).
 */
export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retaildb',
    entities: [
      IncomeSegment,
      AccessibilityZoneEntity,
      AccessibilityWeightEntity,
      AccessibilityComponentEntity,
      Scenario,
      ScenarioChange,
      ScenarioResult,
      Recommendation,
      RecommendationEvidence,
    ],
    // El schema ya existe (db/schema.sql). NUNCA se activa synchronize: este
    // servicio solo lee/escribe filas, jamás debe alterar la estructura.
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
  }),
);
