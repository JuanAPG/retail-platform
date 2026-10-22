import { Module } from '@nestjs/common';
import { AlgorithmsClient } from './algorithms-client.service';

/** Lectura de reglas de asociación en algorithms-core (D3); lo importa recomendaciones. */
@Module({
  providers: [AlgorithmsClient],
  exports: [AlgorithmsClient],
})
export class AlgorithmsModule {}
