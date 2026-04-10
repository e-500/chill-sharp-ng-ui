import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillService } from '../services/chill.service';

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [RouterOutlet, ChillI18nLabelComponent],
  template: `
    <section class="auth-layout">
      <div class="auth-layout__hero">
        <p class="auth-layout__eyebrow">
          <app-chill-i18n-label
            [labelGuid]="'D8E9F1A4-3E8A-47A7-BE9C-1C702F81C6B0'"
            [primaryDefaultText]="'ChillSharp UI'"
            [secondaryDefaultText]="'ChillSharp UI'" />
        </p>
        <h1>
          <app-chill-i18n-label
            [labelGuid]="'38C43178-A697-4DE7-BA27-1989DD0E9B69'"
            [primaryDefaultText]="'Identity that stays out of the way.'"
            [secondaryDefaultText]="'Identita che resta fuori dal percorso.'" />
        </h1>
        <p>
          <app-chill-i18n-label
            [labelGuid]="'9B329C57-797A-43DF-930B-583C44A21D57'"
            [primaryDefaultText]="'Separate auth pages now lead into a dedicated workspace built to host user tasks without mixing concerns.'"
            [secondaryDefaultText]="'Le pagine di autenticazione ora conducono a un workspace dedicato, pensato per ospitare le attivita utente senza mescolare le responsabilita.'" />
        </p>
      </div>

      <div class="auth-layout__content">
        <router-outlet />
      </div>
    </section>
  `
})
export class AuthShellComponent {
  readonly chill = inject(ChillService);
}
