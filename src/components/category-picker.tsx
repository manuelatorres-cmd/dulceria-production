"use client";

import { useFillingCategories } from "@/lib/hooks";

interface CategoryPickerProps {
  category: string;
  onCategoryChange: (cat: string) => void;
}

/** Datalist combobox — arrow keys + Enter select, opens downward
 *  consistently. Typing a new name is allowed; saver can create it.
 *  See feedback_form_ux_patterns.md (datalist baseline pattern). */
export function CategoryPicker({ category, onCategoryChange }: CategoryPickerProps) {
  const categories = useFillingCategories();
  return (
    <div>
      <label className="label">Category</label>
      <input
        type="text"
        list="filling-category-list"
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        placeholder="Select or type a category…"
        className="input"
      />
      {categories.length > 0 && (
        <datalist id="filling-category-list">
          {categories.map((cat) => (
            <option key={cat.id ?? cat.name} value={cat.name} />
          ))}
        </datalist>
      )}
    </div>
  );
}
