import type { DomainModel } from "./domain-context.ts";

export const domainFixtureText = `# Checkout

**Receipt**: A formatted summary of a Cart, showing its final amount.

**Cart**: A collection of Items whose prices and quantities determine the subtotal.

**Item**: One priced entry with a quantity in a Cart.
`;

export const domainFixtureModel: DomainModel = {
  id:"checkout",context:"Checkout",path:"CONTEXT.md",scope:"",
  concepts:[
    {id:"receipt",term:"Receipt",definition:"A formatted summary of a Cart, showing its final amount.",source:{path:"CONTEXT.md",line:3,quote:"**Receipt**: A formatted summary of a Cart, showing its final amount."}},
    {id:"cart",term:"Cart",definition:"A collection of Items whose prices and quantities determine the subtotal.",source:{path:"CONTEXT.md",line:5,quote:"**Cart**: A collection of Items whose prices and quantities determine the subtotal."}},
    {id:"item",term:"Item",definition:"One priced entry with a quantity in a Cart.",source:{path:"CONTEXT.md",line:7,quote:"**Item**: One priced entry with a quantity in a Cart."}},
  ],
  relationships:[
    {from:"receipt",to:"cart",label:"summarises",source:{path:"CONTEXT.md",line:3,quote:"**Receipt**: A formatted summary of a Cart, showing its final amount."}},
    {from:"cart",to:"item",label:"contains",source:{path:"CONTEXT.md",line:5,quote:"**Cart**: A collection of Items whose prices and quantities determine the subtotal."}},
  ],
  bindings:[{mapId:"architecture-behavior",nodeId:"receipt",conceptId:"receipt",sourcePath:"src/receipt.ts"},{mapId:"architecture-journey",nodeId:"receipt",conceptId:"receipt",sourcePath:"src/receipt.ts"}],
};
