import './styles/main.css';
import { SquishyCatalog } from './models/popularSquishies';
import { SquishyStage3D } from './engine/SquishyStage3D';
import { AppUI } from './ui/AppUI';

const app = document.getElementById('app')!;

const stageContainer = document.createElement('div');
stageContainer.className = 'stage-container';
app.appendChild(stageContainer);

const firstSquishy = SquishyCatalog.getAll()[0];

const stage = new SquishyStage3D(stageContainer, firstSquishy);

const ui = new AppUI(stage);
ui.startTick();
