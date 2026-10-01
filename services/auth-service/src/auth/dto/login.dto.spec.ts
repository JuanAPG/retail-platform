import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('rechaza email mal formado y password corta', async () => {
    const dto = Object.assign(new LoginDto(), { email: 'no-es-email', password: 'corta' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('acepta credenciales bien formadas', async () => {
    const dto = Object.assign(new LoginDto(), { email: 'analista@retail.mx', password: 'Passw0rd123!' });
    expect(await validate(dto)).toHaveLength(0);
  });
});
