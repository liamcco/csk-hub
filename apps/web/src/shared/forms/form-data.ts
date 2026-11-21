// Readers for submitted forms. File inputs are not text: each reader treats them as absent.

/** The field's text, or an empty string when the form has no such text field. */
export function formText(formData: FormData, name: string) {
  const raw = formData.get(name)
  return typeof raw === "string" ? raw : ""
}

/** The field's text, or undefined when the form has no such text field. */
export function formField(formData: FormData, name: string) {
  const raw = formData.get(name)
  return typeof raw === "string" ? raw : undefined
}

/** The field's text, or undefined when it is absent or blank. */
export function formValue(formData: FormData, name: string) {
  const raw = formData.get(name)
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined
}

/** Every text value submitted under the name, such as the checked boxes of a group. */
export function formValues(formData: FormData, name: string) {
  return formData.getAll(name).filter((item): item is string => typeof item === "string")
}
