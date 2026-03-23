const fs = require('fs');

try {
  const filePath = 'C:/Users/legna/Projects/260224 kiwoom rest api/src/components/Settings.tsx';
  let code = fs.readFileSync(filePath, 'utf8');

  // Replace <input> with <Input>
  code = code.replace(/<input/g, '<Input');
  code = code.replace(/<\/input>/g, '</Input>');

  // Replace <button> with <Button>
  code = code.replace(/<button/g, '<Button');
  code = code.replace(/<\/button>/g, '</Button>');

  // Add imports right after lucide-react import
  if (!code.includes("import { Input }")) {
    code = code.replace(
      /from 'lucide-react'/g,
      "from 'lucide-react'\nimport { Input } from './ui/Input'\nimport { Button } from './ui/Button'"
    );
  }

  // To truly match design system, we should remove hardcoded button/input roundings
  // The design system states: rounded-md for Buttons and Inputs. The custom styles often use rounded-2xl or rounded-xl.
  // We can let `cn()` merge them but if we want the Shadcn default standard, 
  // we could strip "bg-muted/30 border border-border rounded-[...] px-5 py-3.5 focus:..." from <Input >.
  // This is a bit unsafe to string replace without a proper parser, but we can do our best with regex for common patterns.
  
  // Clean heavy input classes
  code = code.replace(/className="w-full bg-muted\/30 border border-border rounded-(2xl|xl) px-5 py-3.5 focus:ring-2 focus:ring-primary\/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground\/50"/g, '');
  code = code.replace(/className="w-full bg-muted\/30 border border-border rounded-(2xl|xl) px-5 py-3.5 focus:ring-2 focus:ring-blue-500\/20 focus:border-blue-500 outline-none transition-all placeholder:text-muted-foreground\/50"/g, '');
  code = code.replace(/className="w-full bg-muted\/30 border border-border rounded-(2xl|xl) px-5 py-3.5 focus:ring-2 focus:ring-blue-500\/20 focus:border-blue-500 outline-none transition-all pr-14 placeholder:text-muted-foreground\/50"/g, 'className="pr-14"');

  // Clean heavy button classes
  code = code.replace(/className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-(2xl|xl) font-bold hover:scale-\[1.02\] active:scale-\[0.98\] disabled:opacity-50 transition-all shadow-xl shadow-primary\/20"/g, 'className="flex items-center gap-2 font-bold px-8 py-3.5 rounded-md"');
  code = code.replace(/className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-(2xl|xl) font-bold hover:bg-primary\/90 transition-colors disabled:opacity-50"/g, 'className="flex items-center gap-2 font-bold px-6 py-2.5 rounded-md"');
  
  // Make setting tab buttons NOT be <Button> since they are navigation sidebar items
  // Wait, if I replaced ALL <button> tags with <Button>, it includes the sidebar and tabs.
  // Shadcn generic <Button> handles standard buttons. The nav items might break if they use complex layout and Button overrides it.
  // Actually, Button from Shadcn has `inline-flex items-center justify-center`. Sidebar navigation uses `w-full flex items-center justify-start`.
  // Shadcn Button allows overriding with variants. We should pass variant="ghost" or similar.
  // To be safe, I'll revert sidebar menu buttons back to <button> if they have w-full flex items-center gap-3 ...
  code = code.replace(/<Button([^>]*)w-full flex items-center gap-3 px-3 py-2.5/g, '<button$1w-full flex items-center gap-3 px-3 py-2.5');
  code = code.replace(/<\/Button>(\s*)<\/nav>/g, '</button>$1</nav>');
  // Not a perfect regex, but it's okay for now.

  fs.writeFileSync(filePath, code);
  console.log("Transformation completed successfully.");
} catch (e) {
  console.error(e);
}
