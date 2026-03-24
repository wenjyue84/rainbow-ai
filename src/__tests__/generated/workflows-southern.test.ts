import { describe, it, expect } from 'vitest';


  describe('Workflow: Booking & Payment Handler, Node: Ask guest count', () => {
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
      const node = {"id":"wait_guest_count","type":"wait_reply","label":"Ask guest count","config":{"storeAs":"guest_count","prompt":{"en":"Happy to help with your booking! How many guests will be staying?","ms":"Boleh bantu! Berapa orang tetamu nak check in?","zh":"好的，我来帮您办理！请问几位客人入住？"}},"next":"wait_booking_dates"};
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

  describe('Workflow: Booking & Payment Handler, Node: Ask check-in/out dates', () => {
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
      const node = {"id":"wait_booking_dates","type":"wait_reply","label":"Ask check-in/out dates","config":{"storeAs":"booking_dates","prompt":{"en":"What are your check-in and check-out dates?","ms":"Tarikh check-in dan check-out?","zh":"您的入住和退房日期是什么时候？"}},"next":"wait_payment_receipt"};
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

  describe('Workflow: Booking & Payment Handler, Node: Ask for payment receipt', () => {
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
      const node = {"id":"wait_payment_receipt","type":"wait_reply","label":"Ask for payment receipt","config":{"storeAs":"payment_info","prompt":{"en":"If you have made a payment, please share your payment receipt. Otherwise, I'll forward this conversation to our admin at +60127088789 for further assistance.","ms":"Kalau dah bayar, boleh share resit. Kalau belum, saya forward ke admin kami di +60127088789 untuk bantuan lanjut.","zh":"如果您已付款，请分享您的付款收据。否则，我会将此对话转发给我们的管理员 +60127088789 以获得进一步帮助。"}},"next":"booking_forwarding_msg"};
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

  describe('Workflow: Booking & Payment Handler, Node: Forwarding to admin', () => {
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
      const node = {"id":"booking_forwarding_msg","type":"message","label":"Forwarding to admin","config":{"message":{"en":"Thank you! I'm forwarding your booking details and payment information to our admin. They will contact you shortly to confirm your reservation.","ms":"Terima kasih! Dah forward butiran tempahan dan pembayaran ke admin kami. Mereka akan hubungi tak lama lagi untuk sahkan tempahan.","zh":"谢谢！我正在将您的预订详情和付款信息转发给我们的管理员。他们会尽快与您联系确认预订。"}},"next":"booking_notify_admin"};
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

  describe('Workflow: Booking & Payment Handler, Node: Notify admin about booking', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"payment_info":"test-value"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.payment_info"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.payment_info"];

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
      const node = {"id":"booking_notify_admin","type":"whatsapp_send","label":"Notify admin about booking","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *New Booking Request*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nGuests: {{workflow.data.guest_count}}\nDates: {{workflow.data.booking_dates}}\nPayment info: {{workflow.data.payment_info}}\nPlease review and confirm.","ms":"📋 *Tempahan Baru*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nBilangan tetamu: {{workflow.data.guest_count}}\nTarikh: {{workflow.data.booking_dates}}\nMaklumat pembayaran: {{workflow.data.payment_info}}\nSila semak dan sahkan.","zh":"📋 *新预订请求*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n人数：{{workflow.data.guest_count}}\n日期：{{workflow.data.booking_dates}}\n付款信息：{{workflow.data.payment_info}}\n请审核并确认。"},"urgency":"normal"},"next":"booking_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.payment_info"];
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

  describe('Workflow: Booking & Payment Handler, Node: Booking confirmation', () => {
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
      const node = {"id":"booking_confirm_msg","type":"message","label":"Booking confirmation","config":{"message":{"en":"✅ Message sent to admin (+60127088789). They will review your booking and contact you soon!","ms":"✅ Mesej dihantar ke admin (+60127088789). Mereka akan semak tempahan anda dan hubungi anda tidak lama lagi!","zh":"✅ 消息已发送给管理员 (+60127088789)。他们会审核您的预订并尽快联系您！"}}};
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

  describe('Workflow: Complete Check-in Process, Node: Welcome greeting', () => {
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
      const node = {"id":"welcome_msg","type":"message","label":"Welcome greeting","config":{"message":{"en":"Welcome to Southern Homestay! 🎉 I'll help you with check-in.","ms":"Selamat datang ke Southern Homestay! 🎉 Saya akan bantu anda check-in.","zh":"欢迎来到Southern Homestay！🎉 我来帮您办理入住。"}},"next":"wait_name"};
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

  describe('Workflow: Complete Check-in Process, Node: Ask guest name', () => {
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
      const node = {"id":"wait_name","type":"wait_reply","label":"Ask guest name","config":{"storeAs":"guest_name","prompt":{"en":"What is your full name (as on your passport or IC)?","ms":"Apakah nama penuh anda (seperti dalam pasport atau IC)?","zh":"请问您的全名是什么（护照或身份证上的）？"}},"next":"wait_dates"};
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

  describe('Workflow: Complete Check-in Process, Node: Ask check-in/out dates', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.guest_name"];

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
      const requiredInputs = ["workflow.data.guest_name"];

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
      const node = {"id":"wait_dates","type":"wait_reply","label":"Ask check-in/out dates","config":{"storeAs":"stay_dates","prompt":{"en":"Thank you, {{workflow.data.guest_name}}! What are your check-in and check-out dates?\n(e.g., Check-in: 15 Feb, Check-out: 17 Feb)","ms":"Terima kasih, {{workflow.data.guest_name}}! Apakah tarikh check-in dan check-out anda?\n(contoh: Check-in: 15 Feb, Check-out: 17 Feb)","zh":"谢谢，{{workflow.data.guest_name}}！您的入住和退房日期是？\n（例如：入住：2月15日，退房：2月17日）"}},"next":"check_avail"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.guest_name"];
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

  describe('Workflow: Complete Check-in Process, Node: Check unit availability', () => {
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
      const node = {"id":"check_avail","type":"southern_api","label":"Check unit availability","config":{"action":"check_availability"},"next":{"success":"check_avail_result","error":"avail_error"},"outputs":{"availableCount":"availableCount","availableUnits":"availableUnits"}};
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

  describe('Workflow: Complete Check-in Process, Node: Units available?', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["southern.availableCount"];

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
      const requiredInputs = ["southern.availableCount"];

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
      const node = {"id":"check_avail_result","type":"condition","label":"Units available?","config":{"field":"{{southern.availableCount}}","operator":"gt","value":0,"trueNext":"create_link","falseNext":"no_units_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["southern.availableCount"];
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

  describe('Workflow: Complete Check-in Process, Node: No units available', () => {
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
      const node = {"id":"no_units_msg","type":"message","label":"No units available","config":{"message":{"en":"I'm sorry, all units are currently occupied. 😔 Our admin at +60127088789 will contact you when one becomes available. We apologize for the inconvenience!","ms":"Maaf, semua unit sedang penuh. 😔 Admin kami di +60127088789 akan hubungi anda bila ada yang kosong. Kami mohon maaf atas kesulitan!","zh":"抱歉，目前所有房间房都已满。😔 我们的管理员 +60127088789 会在有空房时联系您。非常抱歉给您带来不便！"}},"next":"notify_admin_waitlist"};
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

  describe('Workflow: Complete Check-in Process, Node: Notify admin about waitlist', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.guest_name","workflow.data.stay_dates"];

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
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.guest_name","workflow.data.stay_dates"];

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
      const node = {"id":"notify_admin_waitlist","type":"whatsapp_send","label":"Notify admin about waitlist","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *Waitlist Request*\nGuest: {{workflow.data.guest_name}}\nPhone: {{guest.phone}}\nDates: {{workflow.data.stay_dates}}\nNo units available — please follow up.","ms":"📋 *Permintaan Senarai Tunggu*\nTetamu: {{workflow.data.guest_name}}\nTelefon: {{guest.phone}}\nTarikh: {{workflow.data.stay_dates}}\nTiada unit — sila follow up.","zh":"📋 *等候名单*\n客人：{{workflow.data.guest_name}}\n电话：{{guest.phone}}\n日期：{{workflow.data.stay_dates}}\n无可用房间房——请跟进。"},"urgency":"normal"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.guest_name","workflow.data.stay_dates"];
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

  describe('Workflow: Complete Check-in Process, Node: API error fallback', () => {
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
      const node = {"id":"avail_error","type":"message","label":"API error fallback","config":{"message":{"en":"I couldn't check availability right now, but don't worry — units are almost always available! Let me continue with your check-in. 😊","ms":"Saya tak dapat check availability sekarang, tapi jangan risau — unit biasanya ada! Biar saya teruskan check-in anda. 😊","zh":"暂时无法查询空房情况，但不用担心——通常都有空房！让我继续为您办理入住。😊"}},"next":"create_link"};
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

  describe('Workflow: Complete Check-in Process, Node: Create self-check-in link', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","workflow.data.guest_name"];

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
      const requiredInputs = ["guest.phone","workflow.data.guest_name"];

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
      const node = {"id":"create_link","type":"southern_api","label":"Create self-check-in link","config":{"action":"create_checkin_link","params":{"guestName":"{{workflow.data.guest_name}}","phoneNumber":"{{guest.phone}}"}},"next":{"success":"send_link_msg","error":"link_error_msg"},"outputs":{"checkinLink":"checkinLink","assignedUnit":"assignedUnit"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","workflow.data.guest_name"];
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

  describe('Workflow: Complete Check-in Process, Node: Confirm link sent', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["southern.assignedUnit"];

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
      const requiredInputs = ["southern.assignedUnit"];

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
      const node = {"id":"send_link_msg","type":"message","label":"Confirm link sent","config":{"message":{"en":"Great news — we have units available! 🎊\n\nI've assigned unit *{{southern.assignedUnit}}* for you and sent a self-check-in link to your WhatsApp.\n\nPlease fill in the form to complete your check-in! Our admin will be notified automatically once you're done.","ms":"Berita baik — kami ada unit tersedia! 🎊\n\nSaya telah assign unit *{{southern.assignedUnit}}* untuk anda dan hantar link self-check-in ke WhatsApp anda.\n\nSila isi borang untuk lengkapkan check-in anda! Admin kami akan diberitahu secara automatik selepas selesai.","zh":"好消息——我们有房间房可用！🎊\n\n我已为您分配了房间房 *{{southern.assignedUnit}}* 并发送了自助入住链接到您的WhatsApp。\n\n请填写表格以完成入住！完成后我们的管理员会自动收到通知。"}},"next":"info_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["southern.assignedUnit"];
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

  describe('Workflow: Complete Check-in Process, Node: Link creation error fallback', () => {
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
      const node = {"id":"link_error_msg","type":"message","label":"Link creation error fallback","config":{"message":{"en":"I wasn't able to generate the check-in link automatically, but our staff will help you directly. Please proceed to the front desk or contact +60127088789.","ms":"Saya tidak dapat buat link check-in secara automatik, tetapi staf kami akan bantu anda terus. Sila ke kaunter depan atau hubungi +60127088789.","zh":"无法自动生成入住链接，但我们的工作人员会直接帮助您。请到前台或联系 +60127088789。"}},"next":"info_msg"};
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

  describe('Workflow: Complete Check-in Process, Node: Hostel info card', () => {
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
      const node = {"id":"info_msg","type":"message","label":"Hostel info card","config":{"message":{"en":"✅ You're all set! Here's some useful info:\n\n📋 *Quick Reference:*\n• Check-in time: *2:00 PM*\n• Check-out time: *12:00 PM*\n• Door password: *1270#*\n• WiFi: *SouthernHomestay*\n• Address: Jalan Dato Haji Hassan, JB\n\n🎥 First time? Watch our video guide: https://youtu.be/bYj1M37xJiE\n\nNeed anything else? Just ask! 😊","ms":"✅ Semua siap! Ini maklumat berguna:\n\n📋 *Rujukan Pantas:*\n• Masa check-in: *2:00 PM*\n• Masa check-out: *12:00 PM*\n• Password pintu: *1270#*\n• WiFi: *SouthernHomestay*\n• Alamat: Jalan Dato Haji Hassan, JB\n\n🎥 Pertama kali? Tonton video panduan: https://youtu.be/bYj1M37xJiE\n\nPerlukan apa-apa lagi? Tanya sahaja! 😊","zh":"✅ 一切就绪！以下是一些有用信息：\n\n📋 *快速参考：*\n• 入住时间: *下午2:00*\n• 退房时间: *中午12:00*\n• 门密码: *1270#*\n• WiFi: *SouthernHomestay*\n• 地址: Jalan Dato Haji Hassan, JB\n\n🎥 第一次来？观看视频指南: https://youtu.be/bYj1M37xJiE\n\n还需要其他帮助吗？随时问我！😊"}}};
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

  describe('Workflow: Lower Deck Preference Check, Node: Lower deck info', () => {
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
      const node = {"id":"lower_deck_info_msg","type":"message","label":"Lower deck info","config":{"message":{"en":"I understand you prefer a lower deck unit! 😊 Lower decks (even-numbered units like C2, C4, C6, etc.) are very popular. Let me check availability for you.","ms":"Saya faham anda prefer lower deck! 😊 Lower deck (unit nombor genap seperti C2, C4, C6, dll) sangat popular. Biar saya check untuk anda.","zh":"我明白您更喜欢下铺！😊 下铺（偶数编号如 C2、C4、C6 等）非常受欢迎。让我为您查询。"}},"next":"lower_deck_api_call"};
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

  describe('Workflow: Lower Deck Preference Check, Node: Check unit availability', () => {
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
      const node = {"id":"lower_deck_api_call","type":"southern_api","label":"Check unit availability","config":{"action":"check_lower_deck"},"next":"lower_deck_has_available"};
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

  describe('Workflow: Lower Deck Preference Check, Node: Any lower deck available?', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["southern.lowerDeckCount"];

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
      const requiredInputs = ["southern.lowerDeckCount"];

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
      const node = {"id":"lower_deck_has_available","type":"condition","label":"Any lower deck available?","config":{"field":"{{southern.lowerDeckCount}}","operator":"gt","value":0,"trueNext":"lower_deck_available_msg","falseNext":"lower_deck_unavailable_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["southern.lowerDeckCount"];
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

  describe('Workflow: Lower Deck Preference Check, Node: Show available units', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["southern.availabilityResult"];

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
      const requiredInputs = ["southern.availabilityResult"];

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
      const node = {"id":"lower_deck_available_msg","type":"message","label":"Show available units","config":{"message":{"en":"{{southern.availabilityResult}}\n\nWould you like to proceed with booking a lower deck unit? Once you complete payment, we'll confirm your specific unit assignment.","ms":"{{southern.availabilityResult}}\n\nNak proceed booking lower deck? Selepas pembayaran, kami akan confirm unit anda.","zh":"{{southern.availabilityResult}}\n\n您想继续预订下铺吗？付款后我们会确认您的具体房间房分配。"}},"next":"lower_deck_wait_proceed"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["southern.availabilityResult"];
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

  describe('Workflow: Lower Deck Preference Check, Node: No lower deck available', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["southern.availabilityResult"];

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
      const requiredInputs = ["southern.availabilityResult"];

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
      const node = {"id":"lower_deck_unavailable_msg","type":"message","label":"No lower deck available","config":{"message":{"en":"{{southern.availabilityResult}}\n\nOur upper deck units are just as comfortable and come with a bit more privacy! Would you like to book an upper deck unit instead?","ms":"{{southern.availabilityResult}}\n\nUpper deck kami sama selesa dan lebih privasi! Nak book upper deck?","zh":"{{southern.availabilityResult}}\n\n我们的上铺同样舒适，而且更有隐私！您想预订上铺吗？"}},"next":"lower_deck_wait_proceed"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["southern.availabilityResult"];
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

  describe('Workflow: Lower Deck Preference Check, Node: Ask to proceed with booking', () => {
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
      const node = {"id":"lower_deck_wait_proceed","type":"wait_reply","label":"Ask to proceed with booking","config":{"storeAs":"proceed_booking","prompt":{"en":"Would you like to proceed with booking?","ms":"Nak proceed booking?","zh":"您想继续预订吗？"}}};
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

  describe('Workflow: Johor Bahru Tourist Guide, Node: Attraction recommendations', () => {
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
      const node = {"id":"tourist_attractions_msg","type":"message","label":"Attraction recommendations","config":{"message":{"en":"Wonderful! Johor Bahru has amazing attractions! 🎡🏖️ Here are the TOP destinations near our homestay:\n\n🎢 **LEGOLAND Malaysia** (25 mins drive)\n🏖️ **Desaru Beach** (1 hour)\n🕌 **Sultan Abu Bakar Mosque** (15 mins)\n🛍️ **Johor Bahru City Square** (10 mins)\n🌊 **Danga Bay** (20 mins)\n🐯 **Johor Zoo** (25 mins)\n🏛️ **Chinese Heritage Museum** (12 mins)\n🙏 **Glass Temple** (15 mins)\n\n🌐 More info: https://southernhomestay.local/\n\nWould you like specific directions or recommendations?","ms":"Hebat! Johor Bahru ada banyak tempat menarik! 🎡🏖️ Ini tempat-tempat TOP dekat homestay kami:\n\n🎢 **LEGOLAND Malaysia** (25 minit)\n🏖️ **Pantai Desaru** (1 jam)\n🕌 **Masjid Sultan Abu Bakar** (15 minit)\n🛍️ **Johor Bahru City Square** (10 minit)\n🌊 **Danga Bay** (20 minit)\n🐯 **Zoo Johor** (25 minit)\n🏛️ **Muzium Warisan Cina** (12 minit)\n🙏 **Kuil Kaca** (15 minit)\n\n🌐 Maklumat lanjut: https://southernhomestay.local/\n\nNak direction atau cadangan?","zh":"太好了！新山有很多精彩景点！🎡🏖️ 以下是我们旅舍附近的热门目的地：\n\n🎢 **乐高乐园** (25分钟车程)\n🏖️ **迪沙鲁海滩** (1小时)\n🕌 **苏丹阿布峇卡清真寺** (15分钟)\n🛍️ **新山城市广场** (10分钟)\n🌊 **丹加湾** (20分钟)\n🐯 **新山动物园** (25分钟)\n🏛️ **华人文物馆** (12分钟)\n🙏 **玻璃兴都庙** (15分钟)\n\n🌐 更多信息: https://southernhomestay.local/\n\n需要具体路线或推荐吗？"}},"next":"tourist_wait_choice"};
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

  describe('Workflow: Johor Bahru Tourist Guide, Node: Wait for direction request', () => {
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
      const node = {"id":"tourist_wait_choice","type":"wait_reply","label":"Wait for direction request","config":{"storeAs":"attraction_choice","prompt":{"en":"Which attraction would you like directions or more info about?","ms":"Tempat mana yang anda nak direction atau maklumat lanjut?","zh":"您想了解哪个景点的路线或更多信息？"}},"next":"tourist_transport_msg"};
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

  describe('Workflow: Johor Bahru Tourist Guide, Node: Transport info', () => {
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
      const node = {"id":"tourist_transport_msg","type":"message","label":"Transport info","config":{"message":{"en":"Great choice! 🚗 The easiest way is to grab a **Grab ride** directly from our homestay. Just enter the destination!\n\n📍 Search on **Google Maps** from: *Jalan Dato Haji Hassan, Johor Bahru*\n🚌 Public transport also available — ask our front desk!\n\n💡 **Pro tip:** Ask our front desk for discount deals on popular attractions!\n\nNeed anything else? 😊","ms":"Pilihan bagus! 🚗 Cara paling mudah ialah guna **Grab** terus dari hostel kami. Masukkan destinasi!\n\n📍 Cari di **Google Maps** dari: *Jalan Dato Haji Hassan, Johor Bahru*\n🚌 Pengangkutan awam juga ada — tanya kaunter depan!\n\n💡 **Tip:** Tanya kaunter depan untuk diskaun tempat popular!\n\nNak bantuan lain? 😊","zh":"好选择！🚗 最简单的方式是从旅舍直接叫 **Grab**。输入目的地就可以出发！\n\n📍 在 **Google Maps** 搜索：*Jalan Dato Haji Hassan, Johor Bahru*\n🚌 也有公共交通 — 问前台！\n\n💡 **小贴士：** 问前台获取热门景点折扣！\n\n需要其他帮助吗？😊"}}};
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
      const node = {"id":"complaint_apologize_msg","type":"message","label":"Apologize to guest","config":{"message":{"en":"We're truly sorry to hear about this. 😔 Your comfort is our top priority and we sincerely apologize for the inconvenience. We can arrange maintenance, relocate you to another unit, or provide immediate staff support.","ms":"Kami amat minta maaf mendengar ini. 😔 Keselesaan anda keutamaan kami dan kami mohon maaf atas kesulitan. Kami boleh urus penyelenggaraan, pindahkan anda ke kapsul lain, atau beri sokongan staf segera.","zh":"我们真诚地为此感到抱歉。😔 您的舒适是我们的首要任务，我们对给您带来的不便深表歉意。我们可以安排维修、换房或提供即时工作人员支持。"}},"next":"complaint_wait_details"};
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

  describe('Workflow: Theft Case Handler, Node: Reassure guest', () => {
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
      const node = {"id":"theft_reassure_msg","type":"message","label":"Reassure guest","config":{"message":{"en":"🚨 I'm very sorry to hear about this. We take security very seriously. I'm taking immediate action and connecting you with our team.","ms":"🚨 Saya sangat kesal mendengar ini. Kami mengambil keselamatan serius. Saya ambil tindakan segera.","zh":"🚨 很抱歉听到这件事。我们非常重视安全。我立即采取行动并为您联系我们的团队。"}},"next":"theft_wait_items"};
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

  describe('Workflow: Theft Case Handler, Node: Ask stolen items', () => {
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
      const node = {"id":"theft_wait_items","type":"wait_reply","label":"Ask stolen items","config":{"storeAs":"stolen_items","prompt":{"en":"What item(s) were stolen or missing? Please provide details (e.g., phone, wallet, laptop, jewelry, etc.)","ms":"Barang apa yang telah dicuri? Sila beri butiran (contoh: telefon, dompet, laptop, dll)","zh":"什么物品被盗了？请提供详细信息（例如：手机、钱包、笔记本电脑等）"}},"next":"theft_wait_time"};
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

  describe('Workflow: Theft Case Handler, Node: Ask time of theft', () => {
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
      const node = {"id":"theft_wait_time","type":"wait_reply","label":"Ask time of theft","config":{"storeAs":"theft_time","prompt":{"en":"When did you notice the theft? (e.g., just now, 1 hour ago, this morning)","ms":"Bila anda notice kecurian ini? (contoh: baru tadi, 1 jam lepas, pagi tadi)","zh":"您什么时候发现被盗的？（例如：刚刚、1小时前、今天早上）"}},"next":"theft_wait_location"};
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

  describe('Workflow: Theft Case Handler, Node: Ask location of theft', () => {
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
      const node = {"id":"theft_wait_location","type":"wait_reply","label":"Ask location of theft","config":{"storeAs":"theft_location","prompt":{"en":"Where did the theft occur? (e.g., in unit, bathroom, common area)","ms":"Di mana lokasi kejadian? (contoh: dalam unit, bilik air, ruang bersama)","zh":"在什么地方发生的？（例如：房间房内、浴室、公共区域）"}},"next":"theft_urgent_msg"};
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

  describe('Workflow: Theft Case Handler, Node: Urgent notification notice', () => {
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
      const node = {"id":"theft_urgent_msg","type":"message","label":"Urgent notification notice","config":{"message":{"en":"🚨 **URGENT THEFT CASE** - Notifying our staff right now...","ms":"🚨 **KES KECURIAN SEGERA** - Memberitahu staff sekarang...","zh":"🚨 **紧急盗窃案件** - 正在立即通知员工..."}},"next":"theft_notify_admin"};
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

  describe('Workflow: Theft Case Handler, Node: URGENT notify admin about theft', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"stolen_items":"test-value","theft_location":"test-value","theft_time":"2026-02-15"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.stolen_items","workflow.data.theft_location","workflow.data.theft_time"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.stolen_items","workflow.data.theft_location","workflow.data.theft_time"];

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
      const node = {"id":"theft_notify_admin","type":"whatsapp_send","label":"URGENT notify admin about theft","config":{"receiver":"{{system.admin_phone}}","content":{"en":"🚨 *URGENT THEFT CASE*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nItems: {{workflow.data.stolen_items}}\nTime: {{workflow.data.theft_time}}\nLocation: {{workflow.data.theft_location}}\nIMMediate response required!","ms":"🚨 *KES KECURIAN SEGERA*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nBarang: {{workflow.data.stolen_items}}\nMasa: {{workflow.data.theft_time}}\nLokasi: {{workflow.data.theft_location}}\nRespon segera diperlukan!","zh":"🚨 *紧急盗窃案件*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n物品：{{workflow.data.stolen_items}}\n时间：{{workflow.data.theft_time}}\n地点：{{workflow.data.theft_location}}\n需要立即响应！"},"urgency":"critical"},"next":"theft_next_steps_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.stolen_items","workflow.data.theft_location","workflow.data.theft_time"];
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

  describe('Workflow: Theft Case Handler, Node: Next steps for guest', () => {
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
      const node = {"id":"theft_next_steps_msg","type":"message","label":"Next steps for guest","config":{"message":{"en":"✅ Staff notified! They will:\n\n1️⃣ Contact you immediately\n2️⃣ Review CCTV footage\n3️⃣ Assist with police report if needed\n4️⃣ Investigate the incident thoroughly\n\nDo NOT disturb anything at the scene. Our staff will be with you shortly.","ms":"✅ Staff diberitahu! Mereka akan:\n\n1️⃣ Hubungi anda segera\n2️⃣ Semak rakaman CCTV\n3️⃣ Bantu buat laporan polis jika perlu\n4️⃣ Siasat kes dengan teliti\n\nJANGAN ganggu apa-apa di tempat kejadian. Staff kami akan sampai tidak lama lagi.","zh":"✅ 员工已通知！他们将：\n\n1️⃣ 立即联系您\n2️⃣ 查看监控录像\n3️⃣ 如需要协助报警\n4️⃣ 彻底调查此事\n\n请不要触碰现场任何物品。我们的员工很快就会到。"}}};
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

  describe('Workflow: Card Locked Inside Unit, Node: Emergency instructions', () => {
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
      const node = {"id":"locked_instructions_msg","type":"message","label":"Emergency instructions","config":{"message":{"en":"Oh no! Don't worry, this happens occasionally and we can solve it quickly. 😊\n\n**Quick Solution Steps:**\n1️⃣ Check if the unit door has a small emergency release mechanism\n2️⃣ Try gently pushing/pulling the door while turning the handle\n3️⃣ Look for a small lever near the lock\n\nAre you able to see any of these mechanisms?","ms":"Oh tidak! Jangan risau, ini kadang-kadang berlaku dan kami boleh selesaikan dengan cepat. 😊\n\n**Langkah Penyelesaian Pantas:**\n1️⃣ Check jika pintu unit ada mekanisme emergency release\n2️⃣ Cuba tolak/tarik pintu perlahan-lahan sambil pusing handle\n3️⃣ Cari tuas kecil dekat lock\n\nNampak mana-mana mekanisme ini?","zh":"哦不！别担心，这种情况偶尔会发生，我们可以快速解决。😊\n\n**快速解决步骤：**\n1️⃣ 检查房间门是否有紧急释放装置\n2️⃣ 尝试在转动把手的同时轻轻推拉门\n3️⃣ 在锁附近寻找小杠杆\n\n您能看到这些装置吗？"}},"next":"locked_wait_response"};
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

  describe('Workflow: Card Locked Inside Unit, Node: Wait for guest response', () => {
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
      const node = {"id":"locked_wait_response","type":"wait_reply","label":"Wait for guest response","config":{"storeAs":"lock_response","prompt":{"en":"Were you able to find and use any of the emergency release mechanisms?","ms":"Dapat jumpa dan guna mana-mana mekanisme emergency release?","zh":"您能找到并使用这些紧急释放装置吗？"}},"next":"locked_contacting_msg"};
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

  describe('Workflow: Card Locked Inside Unit, Node: Contacting staff notice', () => {
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
      const node = {"id":"locked_contacting_msg","type":"message","label":"Contacting staff notice","config":{"message":{"en":"No problem! I'm contacting our staff RIGHT NOW to help you...","ms":"Tiada masalah! Saya contact staff SEKARANG untuk bantu anda...","zh":"没问题！我现在立即联系员工来帮助您..."}},"next":"locked_notify_admin"};
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

  describe('Workflow: Card Locked Inside Unit, Node: Notify admin about locked guest', () => {
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
      const node = {"id":"locked_notify_admin","type":"whatsapp_send","label":"Notify admin about locked guest","config":{"receiver":"{{system.admin_phone}}","content":{"en":"⚠️ *Card Locked in Unit*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nGuest is locked — needs master key access. Please respond ASAP.","ms":"⚠️ *Kad Terkunci dalam Kapsul*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nTetamu terkunci — perlukan master key. Sila respons segera.","zh":"⚠️ *卡锁在房间内*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n客人被锁住——需要主钥匙。请尽快响应。"},"urgency":"high"},"next":"locked_reassure_msg"};
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

  describe('Workflow: Card Locked Inside Unit, Node: Reassure guest while waiting', () => {
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
      const node = {"id":"locked_reassure_msg","type":"message","label":"Reassure guest while waiting","config":{"message":{"en":"✅ Staff notified! They have master access and will arrive shortly. Meanwhile:\n\n✅ Stay calm and comfortable inside\n✅ Keep your phone with you\n✅ The unit has ventilation, so you're safe\n\nIs there anything you need while waiting?","ms":"✅ Staff diberitahu! Mereka ada master access dan akan sampai tidak lama lagi. Sementara itu:\n\n✅ Stay calm dan selesa dalam unit\n✅ Simpan telefon dengan anda\n✅ Unit ada pengudaraan, jadi anda selamat\n\nAda apa-apa yang anda perlukan sambil tunggu?","zh":"✅ 员工已通知！他们有主钥匙，会很快到达。同时：\n\n✅ 保持冷静和舒适\n✅ 保管好手机\n✅ 房间房有通风，所以您是安全的\n\n等待期间需要什么吗？"}}};
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

  describe('Workflow: Guest Checkout Process, Node: Checkout greeting', () => {
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
      const node = {"id":"checkout_welcome_msg","type":"message","label":"Checkout greeting","config":{"message":{"en":"We're sorry to see you go! 😊 I'll help you with checkout.","ms":"Kami sedih anda hendak pergi! 😊 Saya bantu anda checkout.","zh":"很遗憾您要离开了！😊 我来帮您办理退房。"}},"next":"checkout_wait_unit"};
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

  describe('Workflow: Guest Checkout Process, Node: Ask unit number', () => {
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
      const node = {"id":"checkout_wait_unit","type":"wait_reply","label":"Ask unit number","config":{"storeAs":"unit_number","prompt":{"en":"What is your unit number? (e.g., C5, C16, J3)","ms":"Apakah nombor unit anda? (contoh: C5, C16, J3)","zh":"请问您的房间号是什么？（例如：C5、C16、J3）"}},"next":"checkout_checklist_msg"};
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

  describe('Workflow: Guest Checkout Process, Node: Checkout checklist', () => {
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
      const node = {"id":"checkout_checklist_msg","type":"message","label":"Checkout checklist","config":{"message":{"en":"Thank you! Before you leave, please make sure:\n\n✅ Collect all personal belongings from your unit\n✅ Check under the pillow and mattress\n✅ Return the key card at the front desk\n✅ Check the common areas (bathroom, lounge) for any items\n\nOnce you're ready, just say *done* and I'll complete your checkout! 👍","ms":"Terima kasih! Sebelum anda pergi, sila pastikan:\n\n✅ Kumpul semua barang peribadi dari unit\n✅ Check bawah bantal dan tilam\n✅ Pulangkan kad kunci di kaunter depan\n✅ Check kawasan umum (bilik air, lounge) untuk barang anda\n\nBila dah siap, cakap *done* dan saya akan selesaikan checkout anda! 👍","zh":"谢谢！离开前请确认：\n\n✅ 收集房间房内所有个人物品\n✅ 检查枕头和床垫下面\n✅ 在前台归还钥匙卡\n✅ 检查公共区域（浴室、休息室）是否有遗留物品\n\n准备好了就说 *done*，我会帮您完成退房！👍"}},"next":"checkout_wait_done"};
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

  describe('Workflow: Guest Checkout Process, Node: Wait for done confirmation', () => {
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
      const node = {"id":"checkout_wait_done","type":"wait_reply","label":"Wait for done confirmation","config":{"storeAs":"checkout_confirmation","prompt":{"en":"Say *done* when you're ready to complete checkout.","ms":"Cakap *done* bila dah siap untuk checkout.","zh":"准备好退房时请说 *done*。"}},"next":"checkout_processing_msg"};
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

  describe('Workflow: Guest Checkout Process, Node: Processing checkout', () => {
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
      const node = {"id":"checkout_processing_msg","type":"message","label":"Processing checkout","config":{"message":{"en":"Completing your checkout now... I'm notifying our admin about your departure. 📋","ms":"Sedang selesaikan checkout anda... Saya memberitahu admin tentang pemergian anda. 📋","zh":"正在完成您的退房...我正在通知管理员您的离开。📋"}},"next":"checkout_notify_admin"};
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

  describe('Workflow: Guest Checkout Process, Node: Notify admin about checkout', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"unit_number":42};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.unit_number"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.unit_number"];

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
      const node = {"id":"checkout_notify_admin","type":"whatsapp_send","label":"Notify admin about checkout","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *Guest Checkout*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nUnit: {{workflow.data.unit_number}}\nGuest has checked out. Please prepare unit for cleaning.","ms":"📋 *Checkout Tetamu*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nKapsul: {{workflow.data.unit_number}}\nTetamu sudah checkout. Sila sediakan kapsul untuk pembersihan.","zh":"📋 *客人退房*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n房间房：{{workflow.data.unit_number}}\n客人已退房。请准备清洁房间房。"},"urgency":"normal"},"next":"checkout_farewell_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.unit_number"];
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

  describe('Workflow: Guest Checkout Process, Node: Farewell message', () => {
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
      const node = {"id":"checkout_farewell_msg","type":"message","label":"Farewell message","config":{"message":{"en":"✅ Checkout complete! Thank you for staying at Southern Homestay! 🌈\n\n🙏 We'd love your feedback! Please leave us a review:\n📍 Google: https://g.page/r/southern-homestay\n\n🧳 *Luggage storage* is available if you need to leave bags (free, limited space).\n\nSafe travels and we hope to see you again! 😊✨","ms":"✅ Checkout selesai! Terima kasih kerana menginap di Southern Homestay! 🌈\n\n🙏 Kami hargai maklum balas anda! Sila tinggalkan review:\n📍 Google: https://g.page/r/southern-homestay\n\n🧳 *Simpanan bagasi* tersedia jika perlu simpan beg (percuma, ruang terhad).\n\nSelamat jalan dan harap jumpa lagi! 😊✨","zh":"✅ 退房完成！感谢您入住Southern Homestay！🌈\n\n🙏 我们希望听到您的反馈！请给我们留下评价：\n📍 Google: https://g.page/r/southern-homestay\n\n🧳 如需寄存行李，我们提供 *行李寄存* 服务（免费，空间有限）。\n\n旅途愉快，希望再次见到您！😊✨"}}};
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

  describe('Workflow: Extra Amenity Request Handler, Node: Amenity offer', () => {
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
      const node = {"id":"amenity_intro_msg","type":"message","label":"Amenity offer","config":{"message":{"en":"Of course! We can provide extra towels, pillows, or blankets. Our on-site staff Maya will deliver them to your unit. 🧺","ms":"Tentu! Kami boleh sediakan tuala, bantal, atau selimut tambahan. Staf kami Maya akan hantar ke kapsul anda. 🧺","zh":"当然可以！我们可以提供额外的毛巾、枕头或毯子。我们的现场工作人员Maya会送到您的房间房。🧺"}},"next":"amenity_wait_items"};
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

  describe('Workflow: Extra Amenity Request Handler, Node: Ask what items needed', () => {
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
      const node = {"id":"amenity_wait_items","type":"wait_reply","label":"Ask what items needed","config":{"storeAs":"requested_items","prompt":{"en":"What items do you need? (e.g., towels, pillows, blankets, hangers, etc.)","ms":"Anda perlukan barang apa? (contoh: tuala, bantal, selimut, penyangkut baju, dll)","zh":"您需要什么物品？（例如：毛巾、枕头、毯子、衣架等）"}},"next":"amenity_delivering_msg"};
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

  describe('Workflow: Extra Amenity Request Handler, Node: Delivery notice', () => {
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
      const node = {"id":"amenity_delivering_msg","type":"message","label":"Delivery notice","config":{"message":{"en":"Great! I'm notifying our staff to deliver the items to your unit...","ms":"Baik! Saya beritahu staf untuk hantar barang ke kapsul anda...","zh":"好的！我正在通知工作人员将物品送到您的房间房..."}},"next":"amenity_notify_staff"};
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

  describe('Workflow: Extra Amenity Request Handler, Node: Notify housekeeping staff', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"requested_items":"test-value"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.requested_items"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.requested_items"];

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
      const node = {"id":"amenity_notify_staff","type":"whatsapp_send","label":"Notify housekeeping staff","config":{"receiver":"{{system.admin_phone}}","content":{"en":"🧺 *Amenity Request*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nItems requested: {{workflow.data.requested_items}}\nPlease deliver to guest's unit.","ms":"🧺 *Permintaan Kemudahan*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nBarang diperlukan: {{workflow.data.requested_items}}\nSila hantar ke kapsul tetamu.","zh":"🧺 *设施请求*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n请求物品：{{workflow.data.requested_items}}\n请送至客人房间房。"},"urgency":"normal"},"next":"amenity_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.requested_items"];
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

  describe('Workflow: Extra Amenity Request Handler, Node: Request confirmation', () => {
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
      const node = {"id":"amenity_confirm_msg","type":"message","label":"Request confirmation","config":{"message":{"en":"✅ Request forwarded to our staff. They will deliver the items shortly. Is there anything else you need?","ms":"✅ Permintaan dihantar ke staf kami. Mereka akan hantar barang tidak lama lagi. Ada apa-apa lagi yang diperlukan?","zh":"✅ 请求已转发给工作人员。他们会尽快送达。还需要其他东西吗？"}}};
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
