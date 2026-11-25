import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionGuard } from '../common/auth/session.guard';
import { FieldVisitsController } from './field-visits.controller';
import { FieldVisitsService } from './field-visits.service';
import { VisitaCampo, VisitaCampoSchema } from './visita-campo.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: VisitaCampo.name, schema: VisitaCampoSchema }]), JwtModule.register({})],
  controllers: [FieldVisitsController],
  providers: [FieldVisitsService, SessionGuard],
})
export class FieldVisitsModule {}
