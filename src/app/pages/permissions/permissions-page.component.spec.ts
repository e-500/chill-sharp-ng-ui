import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChillService } from '../../services/chill.service';
import { WorkspaceToolbarService } from '../../services/workspace-toolbar.service';
import { PermissionsPageComponent } from './permissions-page.component';

describe('PermissionsPageComponent', () => {
  async function createComponent(canManagePermissions: boolean): Promise<ComponentFixture<PermissionsPageComponent>> {
    await TestBed.configureTestingModule({
      imports: [PermissionsPageComponent],
      providers: [
        {
          provide: ChillService,
          useValue: {
            T: (_labelGuid: string, primaryDefaultText: string, secondaryDefaultText: string) => secondaryDefaultText || primaryDefaultText,
            formatError: (error: unknown) => `${error ?? ''}`,
            session: () => ({
              userId: 'user-1',
              userName: 'root'
            }),
            getAuthUsers: () => of([
              {
                guid: 'user-1',
                externalId: 'ext-1',
                userName: 'root',
                displayName: 'Root',
                isActive: true,
                canManagePermissions
              }
            ]),
            getAuthRoles: () => of([
              {
                guid: 'role-1',
                name: 'Administrators',
                description: 'Admin role',
                isActive: true
              }
            ]),
            getAuthUserAccess: () => of({
              user: {
                guid: 'user-1',
                externalId: 'ext-1',
                userName: 'root',
                displayName: 'Root',
                isActive: true,
                canManagePermissions: true
              },
              roles: [],
              permissions: []
            }),
            saveAuthUserAccess: () => of({
              user: {
                guid: 'user-1',
                externalId: 'ext-1',
                userName: 'root',
                displayName: 'Root',
                isActive: true,
                canManagePermissions: true
              },
              roles: [],
              permissions: []
            }),
            getAuthRoleAccess: () => of({
              role: {
                guid: 'role-1',
                name: 'Administrators',
                description: 'Admin role',
                isActive: true
              },
              users: [],
              permissions: []
            }),
            saveAuthRoleAccess: () => of({
              role: {
                guid: 'role-1',
                name: 'Administrators',
                description: 'Admin role',
                isActive: true
              },
              users: [],
              permissions: []
            })
          }
        },
        {
          provide: WorkspaceToolbarService,
          useValue: {
            setButtons: () => void 0,
            clearButtons: () => void 0,
            buttons: () => []
          }
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(PermissionsPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows an empty state when the current user cannot manage permissions', async () => {
    const fixture = await createComponent(false);
    expect(fixture.nativeElement.textContent).toContain('Non disponi dei permessi sufficienti per gestire i permessi.');
  });

  it('shows user and role content when the current user can manage permissions', async () => {
    const fixture = await createComponent(true);
    expect(fixture.nativeElement.textContent).toContain('Utenti');
    expect(fixture.nativeElement.textContent).toContain('Cerca e seleziona un utente');
  });
});
