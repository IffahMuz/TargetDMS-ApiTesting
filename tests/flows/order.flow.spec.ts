import { DATA } from '../../src/testdata';
import { defineOrderFlow } from './order-flow';

defineOrderFlow('work order: create -> get -> delete', 'order-create.json');
defineOrderFlow('parts sales order: create -> get -> delete', 'order-parts-create.json', [DATA.part.number]);
