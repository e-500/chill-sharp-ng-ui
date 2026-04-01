import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChillService } from '../../services/chill.service';

import { CrudPageComponent } from './crud-page.component';

describe('CrudPageComponent', () => {
  let component: CrudPageComponent;
  let fixture: ComponentFixture<CrudPageComponent>;

  beforeEach(async () => {
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
});
