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
                Name: 'EventQuery',
                ChillType: 'Model.Query.EventQuery',
                Type: 'Query',
                RelatedChillType: 'Model.Event'
              }
            ]),
            getSchema: (chillType: string) => of({
              ChillType: chillType,
              DisplayName: chillType,
              QueryRelatedChillType: chillType === 'Model.Query.EventQuery' ? 'Model.Event' : undefined,
              Properties: []
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
