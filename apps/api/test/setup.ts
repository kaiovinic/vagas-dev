import 'reflect-metadata';

import { Logger } from '@nestjs/common';

// Os coletores registram falhas de fonte via Logger; nos testes isso e ruido.
Logger.overrideLogger(false);
