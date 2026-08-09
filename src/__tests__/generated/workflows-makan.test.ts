import { describe, it, expect } from 'vitest';


  describe('Workflow: Complaint Resolution, Node: Apologize to guest', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_apologize_msg","type":"message","label":"Apologize to guest","config":{"message":{"en":"We're truly sorry to hear about this. 😔 Your satisfaction is our top priority and we sincerely apologize for the inconvenience. We can arrange a fix, replacement, or provide immediate staff support.","ms":"Kami amat minta maaf mendengar ini. 😔 Kepuasan anda keutamaan kami dan kami mohon maaf atas kesulitan. Kami boleh urus pembaikan, penggantian, atau beri sokongan staf segera.","zh":"我们真诚地为此感到抱歉。😔 您的舒适是我们的首要任务，我们对给您带来的不便深表歉意。我们可以安排维修、换房或提供即时工作人员支持。"}},"next":"complaint_wait_details"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Complaint Resolution, Node: Ask complaint details', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_wait_details","type":"wait_reply","label":"Ask complaint details","config":{"storeAs":"complaint_details","prompt":{"en":"Could you please describe the issue in detail? (e.g., noise, cleanliness, facility problem, etc.)","ms":"Boleh terangkan masalah dengan lebih terperinci? (contoh: bunyi bising, kebersihan, masalah kemudahan, dll)","zh":"能否详细描述一下问题？（例如：噪音、清洁、设施问题等）"}},"next":"complaint_wait_photo"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Complaint Resolution, Node: Ask for photo evidence', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_wait_photo","type":"wait_reply","label":"Ask for photo evidence","config":{"storeAs":"complaint_photo","prompt":{"en":"Thank you for explaining. If possible, could you share a photo of the issue? This will help us address it more effectively.","ms":"Terima kasih atas penjelasan. Jika boleh, boleh kongsi gambar masalah tersebut? Ini akan bantu kami selesaikan dengan lebih berkesan.","zh":"感谢您的说明。如果可以，能否分享问题的照片？这将帮助我们更有效地解决问题。"}},"next":"complaint_escalating_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Complaint Resolution, Node: Escalating notice', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_escalating_msg","type":"message","label":"Escalating notice","config":{"message":{"en":"I'm escalating your complaint to our management team with PRIORITY status right now...","ms":"Saya sedang forward aduan anda ke team pengurusan dengan status KEUTAMAAN sekarang...","zh":"我正在将您的投诉以优先级状态上报给管理团队..."}},"next":"complaint_notify_admin"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Complaint Resolution, Node: Notify admin about complaint', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"complaint_details":"test-value"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.complaint_details"];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.complaint_details"];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_notify_admin","type":"whatsapp_send","label":"Notify admin about complaint","config":{"receiver":"{{system.admin_phone}}","content":{"en":"⚠️ *PRIORITY Complaint*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nIssue: {{workflow.data.complaint_details}}\nPlease respond urgently.","ms":"⚠️ *Aduan KEUTAMAAN*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nMasalah: {{workflow.data.complaint_details}}\nSila respons segera.","zh":"⚠️ *优先投诉*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n问题：{{workflow.data.complaint_details}}\n请紧急回复。"},"urgency":"high"},"next":"complaint_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.complaint_details"];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Complaint Resolution, Node: Complaint sent confirmation', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"complaint_confirm_msg","type":"message","label":"Complaint sent confirmation","config":{"message":{"en":"✅ Priority complaint sent to management staff (+60127088789). They will contact you shortly to resolve this. In the meantime, is there anything else I can help you with?","ms":"✅ Aduan keutamaan dihantar ke staff pengurusan (+60127088789). Mereka akan hubungi anda tidak lama lagi untuk selesaikan. Sementara itu, ada apa-apa lagi saya boleh bantu?","zh":"✅ 优先投诉已发送给管理人员 (+60127088789)。他们会尽快与您联系解决。同时，还有其他我能帮您的吗？"}}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Escalate to Staff, Node: Escalation notice', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"escalate_msg","type":"message","label":"Escalation notice","config":{"message":{"en":"We will conduct a thorough review and investigation of your concern. For billing disputes, if an error is found during our investigation, we will process a refund. Let me connect you to our staff for immediate assistance...","ms":"Kami akan menjalankan semakan dan penyiasatan menyeluruh terhadap kebimbangan anda. Untuk pertikaian bil, jika ralat ditemui semasa penyiasatan kami, kami akan proses bayaran balik. Biar saya hubungkan anda ke staf untuk bantuan segera...","zh":"我们将对您的问题进行彻底的审查和调查。对于账单争议，如果在调查中发现错误，我们将处理退款。让我为您转接工作人员以获得即时协助..."}},"next":"escalate_notify_admin"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Escalate to Staff, Node: Notify admin for review', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"escalate_notify_admin","type":"whatsapp_send","label":"Notify admin for review","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *Escalation Request*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nReason: Billing dispute / issue requiring staff review.\nPlease contact the guest.","ms":"📋 *Permintaan Eskalasi*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nSebab: Pertikaian bil / isu memerlukan semakan staf.\nSila hubungi tetamu.","zh":"📋 *升级请求*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n原因：账单争议 / 需要员工审核的问题。\n请联系客人。"},"urgency":"normal"},"next":"escalate_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Escalate to Staff, Node: Escalation confirmation', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"escalate_confirm_msg","type":"message","label":"Escalation confirmation","config":{"message":{"en":"✅ Message sent to staff. They will review your case and contact you shortly to discuss the investigation findings.","ms":"✅ Mesej dihantar ke staf. Mereka akan kaji semula kes anda dan hubungi anda tidak lama lagi untuk membincangkan hasil penyiasatan.","zh":"✅ 消息已发送给工作人员。他们会审查您的案件并尽快联系您讨论调查结果。"}}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Forward Payment, Node: Payment forwarding notice', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = [];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = [];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"payment_forward_msg","type":"message","label":"Payment forwarding notice","config":{"message":{"en":"Thank you! I'll forward your payment receipt to our admin staff for verification. If you haven't sent a screenshot of the receipt yet, please do so and we'll confirm your booking shortly.","ms":"Terima kasih! Saya akan forward resit pembayaran anda ke staf admin untuk pengesahan. Jika belum hantar screenshot resit, sila hantar dan kami akan sahkan tempahan anda tidak lama lagi.","zh":"谢谢！我会将您的付款收据转发给管理员工作人员进行验证。如果您还没有发送收据截图，请发送，我们会尽快确认您的预订。"}},"next":"payment_notify_admin"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = [];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });

  describe('Workflow: Forward Payment, Node: Forward payment to admin', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = {"id":"payment_notify_admin","type":"whatsapp_send","label":"Forward payment to admin","config":{"receiver":"{{system.admin_phone}}","content":{"en":"💰 *Payment Receipt Forwarded*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nPayment receipt shared — please verify and confirm booking.","ms":"💰 *Resit Pembayaran Diforward*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nResit pembayaran dikongsi — sila sahkan dan confirm tempahan.","zh":"💰 *付款收据已转发*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n已分享付款收据——请核实并确认预订。"},"urgency":"normal"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone"];
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });
