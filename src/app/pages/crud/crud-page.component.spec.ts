import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChillService } from '../../services/chill.service';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { WorkspaceService } from '../../services/workspace.service';

import { CrudPageComponent } from './crud-page.component';

describe('CrudPageComponent', () => {
  let component: CrudPageComponent;
  let fixture: ComponentFixture<CrudPageComponent>;
  let workspace: jasmine.SpyObj<WorkspaceService>;

  beforeEach(async () => {
    workspace = jasmine.createSpyObj<WorkspaceService>('WorkspaceService', ['openCrudTask']);

    await TestBed.configureTestingModule({
      imports: [CrudPageComponent],
      providers: [
        {
          provide: ChillService,
          useValue: {
            T: (_labelGuid: string, primaryDefaultText: string, secondaryDefaultText: string) => secondaryDefaultText || primaryDefaultText,
            getSchemaList: () => of([
              {
                name: 'EventQuery',
                chillType: 'Model.General.EventQuery',
                type: 'Query',
                relatedChillType: 'Model.Event'
              }
            ]),
            getSchema: (chillType: string) => of({
              chillType: chillType,
              displayName: chillType,
              queryRelatedChillType: chillType === 'Model.General.EventQuery' ? 'Model.Event' : undefined,
              properties: []
            }),
            query: () => of([])
          }
        },
        {
          provide: WorkspaceService,
          useValue: workspace
        },
        {
          provide: WorkspaceDialogService,
          useValue: {
            openDialog: () => Promise.resolve({ status: 'dismissed' })
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CrudPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('resolves placeholder config values from the selected row', () => {
    const row = {
      guid: 'row-1',
      chillType: 'Model.Event',
      properties: {
        parentId: 'parent-42',
        title: 'Parent event'
      }
    };

    expect((component as any).resolveConfigValue('@{parentId}', row)).toBe('parent-42');
    expect((component as any).resolveConfigValue('@{mock}', row)).toEqual({
      guid: 'row-1',
      chillType: 'Model.Event',
      properties: {
        parentId: 'parent-42',
        title: 'Parent event'
      }
    });
    expect((component as any).resolveConfigValue('plain-value', row)).toBe('plain-value');
  });

  it('opens relation CRUD tasks with resolved configuration values', () => {
    const relation = {
      ChillType: 'Model.Child',
      ChillQuery: 'Model.General.ChildQuery',
      FixedQueryValues: {
        ParentId: '@{parentId}',
        Parent: '@{mock}'
      },
      DefaultValues: {
        ParentId: '@{parentId}'
      }
    };
    const row = {
      guid: 'row-1',
      chillType: 'Model.Parent',
      properties: {
        parentId: 'parent-42',
        title: 'Parent event'
      }
    };

    (component as any).openRelation(row, relation);

    expect(workspace.openCrudTask).toHaveBeenCalledWith(jasmine.objectContaining({
      chillType: 'Model.Child',
      queryChillType: 'Model.General.ChildQuery',
      componentConfiguration: jasmine.objectContaining({
        ChillType: 'Model.Child',
        FixedQueryValues: {
          ParentId: 'parent-42',
          Parent: {
            guid: 'row-1',
            chillType: 'Model.Parent',
            properties: {
              parentId: 'parent-42',
              title: 'Parent event'
            }
          }
        },
        DefaultValues: {
          ParentId: 'parent-42'
        }
      })
    }));
  });
});
