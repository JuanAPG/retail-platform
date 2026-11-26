import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { createTransport } from 'nodemailer';
import { DataSource } from 'typeorm';
import { getRedis } from '../common/auth/redis.client';
import { UsuarioEntity } from '../entities/usuario.entity';
import { UsersService } from '../users/users.service';

const TTL = 900;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenKey = (token: string) => `auth:recovery:token:${digest(token)}`;

export class RecoveryRequestDto {
  @IsEmail()
  @MaxLength(150)
  email: string;
}

export class RecoveryConfirmDto {
  @Matches(/^[a-f0-9]{64}$/)
  token: string;

  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
}

const INVALIDATE = `
  if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', 90) then return 0 end
  redis.call('SET', KEYS[2], ARGV[1])
  local current = redis.call('GET', KEYS[3])
  if current then
    local session = cjson.decode(current)
    if session.accessJti then redis.call('SET', 'revoked:'..session.accessJti, '1', 'EX', ARGV[3]) end
    if session.refreshJti then redis.call('SET', 'revoked:'..session.refreshJti, '1', 'EX', ARGV[2]) end
  end
  for _, jti in ipairs(redis.call('ZRANGE', KEYS[4], 0, -1)) do
    redis.call('SET', 'revoked:'..jti, '1', 'EX', ARGV[3])
  end
  redis.call('DEL', KEYS[3], KEYS[4])
  return 1
`;

const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end`;

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(private readonly users: UsersService, private readonly database: DataSource,
    private readonly config: ConfigService) {}

  request(email: string) {
    const smtp = process.env.AUTH_RESET_SMTP_URL;
    const base = process.env.AUTH_RESET_WEB_URL;
    const from = process.env.AUTH_RESET_FROM;
    if (!smtp || !base || !from) throw new ServiceUnavailableException('La recuperación de contraseña no está disponible.');
    const link = new URL(base);
    if (link.protocol !== 'https:' && !(link.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(link.hostname))) {
      throw new ServiceUnavailableException('La recuperación requiere una página HTTPS.');
    }
    void this.send(email, smtp, link, from).catch(() => this.logger.warn('No se pudo entregar un correo de recuperación.'));
    return { message: 'Si la cuenta está activa, recibirás un enlace de recuperación.' };
  }

  private async send(email: string, smtp: string, link: URL, from: string) {
    const user = await this.users.findByEmail(email);
    if (!user?.activo) return;
    const redis = getRedis();
    if (!(await redis.set(`auth:recovery:mail:${user.id}`, '1', 'EX', 60, 'NX'))) return;
    const token = randomBytes(32).toString('hex');
    await redis.set(tokenKey(token), JSON.stringify({ id: user.id, password: digest(user.passwordHash) }), 'EX', TTL);
    link.hash = new URLSearchParams({ token }).toString();
    const smtpUrl = new URL(smtp);
    if (smtpUrl.protocol === 'smtp:' && !['localhost', '127.0.0.1'].includes(smtpUrl.hostname)) {
      smtpUrl.searchParams.set('requireTLS', 'true');
    }
    smtpUrl.searchParams.set('connectionTimeout', '5000');
    smtpUrl.searchParams.set('socketTimeout', '7000');
    const transport = createTransport(smtpUrl.toString(), { from });
    try {
      await transport.sendMail({
        to: user.email, subject: 'Recupera tu contraseña',
        text: `Abre este enlace de un solo uso en los próximos 15 minutos: ${link.toString()}`,
      });
    } catch (error) {
      await redis.del(tokenKey(token), `auth:recovery:mail:${user.id}`);
      throw error;
    } finally {
      transport.close();
    }
  }

  async confirm(dto: RecoveryConfirmDto, accessTtl: number, refreshTtl: number) {
    const redis = getRedis();
    const invalid = () => new BadRequestException('El enlace no es válido, ya se utilizó o venció.');
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('La contraseña excede 72 bytes.');
    const raw = await redis.getdel(tokenKey(dto.token));
    if (!raw) throw invalid();
    const { id, password } = JSON.parse(raw) as { id: string; password: string };
    const user = await this.users.findById(id);
    if (!user?.activo || digest(user.passwordHash) !== password) throw invalid();
    const passwordHash = await bcrypt.hash(dto.password, this.config.getOrThrow<number>('jwt.bcryptSaltRounds'));
    const claim = randomUUID();
    const busy = `auth:recovery:busy:${id}`;
    const count = await redis.eval(INVALIDATE, 4, busy, `auth:recovery:epoch:${id}`,
      `session:${id}`, `auth:issued:${id}`, claim, Math.max(refreshTtl, accessTtl), accessTtl);
    if (!count) throw invalid();
    try {
      const updated = await this.database.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '5s'");
        return manager.update(UsuarioEntity, { id, activo: true, passwordHash: user.passwordHash }, { passwordHash });
      });
      if (!updated.affected) throw invalid();
      return { message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' };
    } finally {
      await redis.eval(UNLOCK, 1, busy, claim);
    }
  }
}
