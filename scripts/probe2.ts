import { scoreProduct } from '../src/lib/ingrefit/scoring';
import type { AnalysisProfile, ProductFacts, GoalId, DietId } from '../src/lib/ingrefit/types';
const empty:any = { energyKcal100g:200,protein100g:5,carbohydrates100g:20,sugars100g:5,fat100g:10,saturatedFat100g:3,fiber100g:2,salt100g:0.5,sodium100g:null,servingSize:null };
const P = (o: Partial<ProductFacts> = {}): ProductFacts => ({source:'ai_label',barcode:null,name:'T',brand:null,quantity:null,imageUrl:null,ingredientsText:null,ingredients:[],allergens:[],traces:[],allergenTags:[],traceTags:[],additives:[],labels:[],labelTags:[],categories:[],ingredientAnalysis:{vegan:null,vegetarian:null,palmOil:null},nutrientLevels:{fat:null,saturatedFat:null,sugars:null,salt:null},fruitsVegetablesNuts100g:null,nutriScore:null,novaGroup:null,ecoScore:null,organic:false,alcoholPercent:null,nutrition:{...empty},nutritionReference:'100g',nutritionBasis:'declared',completeness:100,unknownFields:[],...o} as ProductFacts);
const PR = (o: Partial<AnalysisProfile> = {}): AnalysisProfile => ({goals:['balanced'] as GoalId[],diet:'none' as DietId,allergens:[],avoidedIngredients:[],...o});
const cases: Array<[string,string,string[]]> = [
  ['coconut milk drink','water, coconut milk, sugar',['milk']],
  ['real milk drink','water, milk powder, sugar',['milk']],
  ['nutmeg cake (ru)','мука, сахар, мускатный орех',['tree_nuts']],
  ['walnut cake (ru)','мука, сахар, грецкий орех',['tree_nuts']],
  ['peanut, turkish','bugday unu, seker, yer fistigi, tuz',['peanuts']],
  ['peanut, polish','maka pszenna, cukier, orzeszki ziemne',['peanuts']],
  ['peanut, chinese','小麦粉, 糖, 花生',['peanuts']],
  ['peanut, arabic','دقيق القمح، سكر، فول سوداني',['peanuts']],
  ['gluten, spanish','harina de trigo, azucar',['gluten']],
  ['fish sauce thai','น้ำปลา, น้ำตาล',['fish']],
  ['peanut, swahili (uncovered)','unga wa ngano, sukari, karanga',['peanuts']],
];
for (const [name, text, allergens] of cases) {
  const r = scoreProduct(P({ingredientsText:text}), PR({allergens}));
  const warn = r.signals.find(s=>s.code.startsWith('warning.allergen'));
  console.log(`${(r.blocked?'BLOCKED':'not blocked').padEnd(11)} ${warn?('+'+warn.code.replace('warning.allergen_','')).padEnd(13):''.padEnd(13)} conf=${r.confidence}  ${name}`);
}
// verified-tag path: reader returned tags, none matched -> no warning
const verified = P({ingredientsText:'wheat flour, sugar', allergensVerified:true, allergenTags:['en:gluten']});
const rv = scoreProduct(verified, PR({allergens:['peanuts']}));
console.log('verified tags, peanut profile -> blocked', rv.blocked, 'warn', rv.signals.filter(s=>s.code.includes('allergen')).map(s=>s.code), 'conf', rv.confidence);
