import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
   canActivate(context: ExecutionContext) {
    if (process.env.AUTH_DISABLED === 'true') {
      return true;
    }

    return super.canActivate(context);
  }
}
