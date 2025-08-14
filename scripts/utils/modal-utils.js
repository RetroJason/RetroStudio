// modal-utils.js
// Utility functions for creating custom modal dialogs

class ModalUtils {
  /**
   * Show a custom form dialog with multiple fields
   * @param {string} title - Dialog title
   * @param {Array} fields - Array of field configurations
   * @param {Object} options - Additional options
   * @returns {Promise<Object|null>} - Resolves with form data or null if cancelled
   */
  static showForm(title, fields, options = {}) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      
      // Build form fields HTML
      let fieldsHtml = '';
      fields.forEach((field, index) => {
        const fieldId = `modal-field-${index}`;
        
        if (field.type === 'text' || field.type === 'number') {
          fieldsHtml += `
            <div class="modal-field">
              <label class="modal-label" for="${fieldId}">${field.label}</label>
              <input type="${field.type}" 
                     class="modal-input" 
                     id="${fieldId}"
                     value="${field.defaultValue || ''}"
                     placeholder="${field.placeholder || ''}"
                     ${field.required ? 'required' : ''}
                     ${field.min !== undefined ? `min="${field.min}"` : ''}
                     ${field.max !== undefined ? `max="${field.max}"` : ''}>
              ${field.hint ? `<div class="modal-hint">${field.hint}</div>` : ''}
            </div>
          `;
        } else if (field.type === 'select') {
          fieldsHtml += `
            <div class="modal-field">
              <label class="modal-label" for="${fieldId}">${field.label}</label>
              <select class="modal-select" id="${fieldId}" ${field.required ? 'required' : ''}>
                ${field.options.map(option => 
                  `<option value="${option.value}" ${option.value === field.defaultValue ? 'selected' : ''}>${option.text}</option>`
                ).join('')}
              </select>
              ${field.hint ? `<div class="modal-hint">${field.hint}</div>` : ''}
            </div>
          `;
        } else if (field.type === 'checkbox') {
          fieldsHtml += `
            <div class="modal-field">
              <label class="modal-checkbox-label">
                <input type="checkbox" 
                       class="modal-checkbox" 
                       id="${fieldId}"
                       ${field.defaultValue ? 'checked' : ''}>
                <span class="modal-checkbox-text">${field.label}</span>
              </label>
              ${field.hint ? `<div class="modal-hint">${field.hint}</div>` : ''}
            </div>
          `;
        } else if (field.type === 'textarea') {
          fieldsHtml += `
            <div class="modal-field">
              <label class="modal-label" for="${fieldId}">${field.label}</label>
              <textarea class="modal-textarea" 
                        id="${fieldId}"
                        placeholder="${field.placeholder || ''}"
                        rows="${field.rows || 3}"
                        ${field.required ? 'required' : ''}>${field.defaultValue || ''}</textarea>
              ${field.hint ? `<div class="modal-hint">${field.hint}</div>` : ''}
            </div>
          `;
        }
      });
      
      // Create modal content
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
        </div>
        <div class="modal-body">
          <form id="modal-form">
            ${fieldsHtml}
          </form>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-secondary" id="modal-cancel">${options.cancelText || 'Cancel'}</button>
          <button class="modal-btn modal-btn-primary" id="modal-ok">${options.okText || 'Create'}</button>
        </div>
      `;
      
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Get elements
      const form = dialog.querySelector('#modal-form');
      const okBtn = dialog.querySelector('#modal-ok');
      const cancelBtn = dialog.querySelector('#modal-cancel');
      const inputs = form.querySelectorAll('input, select, textarea');
      
      // Focus first input
      setTimeout(() => {
        if (inputs.length > 0) {
          inputs[0].focus();
          if (inputs[0].type === 'text') {
            inputs[0].select();
          }
        }
      }, 100);
      
      // Validate form
      function validateForm() {
        let isValid = true;
        const formData = {};
        
        fields.forEach((field, index) => {
          const fieldId = `modal-field-${index}`;
          const input = form.querySelector(`#${fieldId}`);
          let value;
          
          if (field.type === 'checkbox') {
            value = input.checked;
          } else if (field.type === 'number') {
            value = parseFloat(input.value);
            if (isNaN(value)) value = field.defaultValue || 0;
          } else {
            value = input.value.trim();
          }
          
          formData[field.name] = value;
          
          // Validate field
          if (field.required && (value === '' || value === null || value === undefined)) {
            isValid = false;
          }
          
          if (field.validator && !field.validator(value)) {
            isValid = false;
          }
        });
        
        okBtn.disabled = !isValid;
        return { isValid, formData };
      }
      
      // Initial validation
      validateForm();
      
      // Handle input changes
      inputs.forEach((input, index) => {
        const field = fields[index];
        
        input.addEventListener('input', () => {
          validateForm();
          
          // Call onInput callback if provided
          if (field.onInput && typeof field.onInput === 'function') {
            const formData = {};
            inputs.forEach((inp, idx) => {
              formData[fields[idx].name] = inp.value;
            });
            field.onInput(input.value, formData);
          }
        });
        
        input.addEventListener('change', validateForm);
        
        // Trigger initial onInput callback for fields with default values
        if (field.onInput && typeof field.onInput === 'function' && input.value) {
          setTimeout(() => {
            const formData = {};
            inputs.forEach((inp, idx) => {
              formData[fields[idx].name] = inp.value;
            });
            field.onInput(input.value, formData);
          }, 100); // Small delay to ensure DOM is ready
        }
      });
      
      // Handle OK button
      function handleOk() {
        const result = validateForm();
        if (result.isValid) {
          cleanup();
          resolve(result.formData);
        }
      }
      
      // Handle Cancel button
      function handleCancel() {
        cleanup();
        resolve(null);
      }
      
      // Cleanup function
      function cleanup() {
        document.body.removeChild(overlay);
      }
      
      // Event listeners
      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      
      // Handle form submission
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleOk();
      });
      
      // Handle Escape key
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      });
      
      // Handle overlay click (close on outside click)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      });
    });
  }

  /**
   * Show a custom prompt dialog
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message/label
   * @param {string} defaultValue - Default input value
   * @param {Object} options - Additional options
   * @returns {Promise<string|null>} - Resolves with input value or null if cancelled
   */
  static showPrompt(title, message, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      
      // Create modal content
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
        </div>
        <div class="modal-body">
          <label class="modal-label">${message}</label>
          <input type="text" class="modal-input" value="${defaultValue}" id="modal-input">
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
          <button class="modal-btn modal-btn-primary" id="modal-ok">OK</button>
        </div>
      `;
      
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Get elements
      const input = dialog.querySelector('#modal-input');
      const okBtn = dialog.querySelector('#modal-ok');
      const cancelBtn = dialog.querySelector('#modal-cancel');
      
      // Focus and select input
      setTimeout(() => {
        input.focus();
        input.select();
      }, 100);
      
      // Validate input
      function validateInput() {
        const value = input.value.trim();
        const isValid = value.length > 0 && (options.validator ? options.validator(value) : true);
        okBtn.disabled = !isValid;
        return isValid;
      }
      
      // Initial validation
      validateInput();
      
      // Handle input changes
      input.addEventListener('input', validateInput);
      
      // Handle OK button
      function handleOk() {
        if (validateInput()) {
          const value = input.value.trim();
          cleanup();
          resolve(value);
        }
      }
      
      // Handle Cancel button
      function handleCancel() {
        cleanup();
        resolve(null);
      }
      
      // Cleanup function
      function cleanup() {
        document.body.removeChild(overlay);
      }
      
      // Event listeners
      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      
      // Handle Enter and Escape keys
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleOk();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      });
      
      // Handle overlay click (close on outside click)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      });
    });
  }
  
  /**
   * Show a custom confirm dialog
   * @param {string} title - Dialog title
   * @param {string} message - Dialog message
   * @param {Object} options - Additional options
   * @returns {Promise<boolean>} - Resolves with true/false
   */
  static showConfirm(title, message, options = {}) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      // Create modal dialog
      const dialog = document.createElement('div');
      dialog.className = 'modal-dialog';
      
      // Create modal content
      dialog.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
        </div>
        <div class="modal-body">
          <p style="color: #cccccc; margin: 0; line-height: 1.5;">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-secondary" id="modal-cancel">${options.cancelText || 'Cancel'}</button>
          <button class="modal-btn ${options.danger ? 'modal-btn-danger' : 'modal-btn-primary'}" id="modal-ok">${options.okText || 'OK'}</button>
        </div>
      `;
      
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      
      // Get elements
      const okBtn = dialog.querySelector('#modal-ok');
      const cancelBtn = dialog.querySelector('#modal-cancel');
      
      // Focus OK button
      setTimeout(() => {
        okBtn.focus();
      }, 100);
      
      // Handle OK button
      function handleOk() {
        cleanup();
        resolve(true);
      }
      
      // Handle Cancel button
      function handleCancel() {
        cleanup();
        resolve(false);
      }
      
      // Cleanup function
      function cleanup() {
        document.body.removeChild(overlay);
      }
      
      // Event listeners
      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      
      // Handle Enter and Escape keys
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleOk();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
      });
      
      // Handle overlay click (close on outside click)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      });
    });
  }
}

// Export for use
window.ModalUtils = ModalUtils;
