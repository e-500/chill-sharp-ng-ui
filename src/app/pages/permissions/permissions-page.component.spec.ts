import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChillService } from '../../services/chill.service';
import { PermissionsPageComponent } from './permissions-page.component';

describe('PermissionsPageComponent', () => {
  let component: PermissionsPageComponent;
  let fixture: ComponentFixture<PermissionsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PermissionsPageComponent],
      providers: [
        {
          provide: ChillService,
          useValue: {
            T: (_labelGuid: string, primaryDefaultText: string, secondaryDefaultText: string) => secondaryDefaultText || primaryDefaultText,
            formatError: (error: unknown) => `${error ?? ''}`,
            getAuthUsers: () => of([
              {
                guid: 'user-1',
                externalId: 'ext-1',
                userName: 'root',
                displayName: 'Root',
                isActive: true,
                canManagePermissions: true
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
            getAuthUserRoles: () => of([]),
            getAuthPermissionRules: () => of([]),
            updateAuthUser: () => of({
              guid: 'user-1',
              externalId: 'ext-1',
              userName: 'root',
              displayName: 'Root',
              isActive: true,
              canManagePermissions: true
            }),
            assignAuthRole: () => of(void 0),
            removeAuthRole: () => of(void 0),
            createAuthRole: () => of({
              guid: 'role-2',
              name: 'Editors',
              description: 'Edit role',
              isActive: true
            }),
            createAuthPermissionRule: () => of({
              guid: 'rule-1',
              userGuid: 'user-1',
              roleGuid: '',
              effect: 1,
              action: 1,
              scope: 1,
              module: 'Auth',
              entityName: '',
              propertyName: '',
              appliesToAllProperties: false,
              description: ''
            }),
            deleteAuthPermissionRule: () => of(void 0)
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PermissionsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
