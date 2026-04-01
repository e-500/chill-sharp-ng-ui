import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChillService } from '../../../services/chill.service';

import { EventViewerComponent } from './event-viewer.component';

describe('EventViewerComponent', () => {
  let component: EventViewerComponent;
  let fixture: ComponentFixture<EventViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventViewerComponent],
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

    fixture = TestBed.createComponent(EventViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
