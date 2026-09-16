import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(function (error) {
    console.log('Error arrancando la aplicacion');
    console.log(error);
  });
