import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'notificaciones_preferencias', versionKey: false })
export class NotificationPreference {
  @Prop({ type: String })
  _id!: string;

  @Prop({ required: true })
  informational!: boolean;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(NotificationPreference);
