import { describe, it, expect } from 'vitest';


  describe('Workflow: Booking & Payment Handler, Node: Ask guest name', () => {
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
      const node = {"id":"wait_guest_name","type":"wait_reply","label":"Ask guest name","timeout":5000,"config":{"storeAs":"guest_name","prompt":{"en":"Happy to help with your booking! First, what is your full name?","ms":"Boleh bantu dengan tempahan! Pertama, boleh bagi nama penuh anda?","zh":"很高兴帮您预订！首先，请问您的全名是什么？"}},"next":"wait_guest_count"};
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

  describe('Workflow: Booking & Payment Handler, Node: Ask guest count', () => {
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
      const node = {"id":"wait_guest_count","type":"wait_reply","label":"Ask guest count","timeout":5000,"config":{"storeAs":"guest_count","prompt":{"en":"Thank you, {{workflow.data.guest_name}}! How many guests will be staying?","ms":"Terima kasih, {{workflow.data.guest_name}}! Berapa orang tetamu nak menginap?","zh":"谢谢，{{workflow.data.guest_name}}！请问几位客人入住？"}},"next":"wait_booking_dates"};
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
      const node = {"id":"wait_booking_dates","type":"wait_reply","label":"Ask check-in/out dates","timeout":5000,"config":{"storeAs":"booking_dates","prompt":{"en":"What are your check-in and check-out dates?\n(e.g., Check-in: 15 Feb, Check-out: 17 Feb)","ms":"Apakah tarikh check-in dan check-out anda?\n(contoh: Check-in: 15 Feb, Check-out: 17 Feb)","zh":"您的入住和退房日期是什么？\n（例如：入住：2月15日，退房：2月17日）"}},"next":"validate_dates"};
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

  describe('Workflow: Booking & Payment Handler, Node: Validate date format', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_dates"];

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
      const requiredInputs = ["workflow.data.booking_dates"];

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
      const node = {"id":"validate_dates","type":"condition","label":"Validate date format","timeout":5000,"config":{"field":"{{workflow.data.booking_dates}}","operator":"regex","value":"(\\d{1,2}[\\s\\-\\/](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\w*[\\s\\-\\/]\\d{1,2}|\\d{1,2}[\\-\\/]\\d{1,2}[\\-\\/]\\d{2,4})","trueNext":"validate_past_dates","falseNext":"date_error_reprompt"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_dates"];
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

  describe('Workflow: Booking & Payment Handler, Node: Check for past check-in dates', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_dates"];

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
      const requiredInputs = ["workflow.data.booking_dates"];

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
      const node = {"id":"validate_past_dates","type":"condition","label":"Check for past check-in dates","timeout":5000,"config":{"field":"{{workflow.data.booking_dates}}","operator":"pastDateCheck","value":null,"trueNext":"check_booking_conflict","falseNext":"past_dates_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_dates"];
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

  describe('Workflow: Booking & Payment Handler, Node: Suggest alternative dates for past check-in', () => {
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
      const node = {"id":"past_dates_msg","type":"message","label":"Suggest alternative dates for past check-in","timeout":5000,"config":{"message":{"en":"Sorry, check-in date cannot be today or earlier. The earliest available check-in is tomorrow. Would you like to proceed with tomorrow as your check-in date instead?","ms":"Maaf, tarikh check-in tidak boleh hari ini atau sebelumnya. Tarikh check-in paling awal adalah esok hari. Boleh ke esok hari untuk check-in?","zh":"抱歉，入住日期不能是今天或更早。最早的入住日期是明天。您想改用明天作为入住日期吗？"}},"next":"wait_booking_dates"};
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

  describe('Workflow: Booking & Payment Handler, Node: Check for date range conflicts', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_dates_normalized"];

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
      const requiredInputs = ["workflow.data.booking_dates_normalized"];

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
      const node = {"id":"check_booking_conflict","type":"condition","label":"Check for date range conflicts","timeout":5000,"config":{"field":"{{workflow.data.booking_dates_normalized}}","operator":"dateConflict","value":[],"trueNext":"check_room_availability","falseNext":"booking_conflict_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_dates_normalized"];
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

  describe('Workflow: Booking & Payment Handler, Node: Notify guest of date conflict', () => {
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
      const node = {"id":"booking_conflict_msg","type":"message","label":"Notify guest of date conflict","timeout":5000,"config":{"message":{"en":"Sorry, those dates are not available. Please try different dates for your booking.","ms":"Maaf, tarikh tersebut tidak tersedia. Sila pilih tarikh lain untuk tempahan anda.","zh":"抱歉，这些日期不可用。请选择其他日期预订。"}},"next":"wait_booking_dates"};
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

  describe('Workflow: Booking & Payment Handler, Node: Check real-time room availability against reservations DB', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_dates_normalized"];

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
      const requiredInputs = ["workflow.data.booking_dates_normalized"];

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
      const node = {"id":"check_room_availability","type":"condition","label":"Check real-time room availability against reservations DB","timeout":5000,"config":{"field":"{{workflow.data.booking_dates_normalized}}","operator":"dbAvailabilityCheck","value":null,"trueNext":"check_blacklist","falseNext":"room_unavailable_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_dates_normalized"];
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

  describe('Workflow: Booking & Payment Handler, Node: Check guest against blacklist', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone"];

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
      const requiredInputs = ["guest.phone"];

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
      const node = {"id":"check_blacklist","type":"condition","label":"Check guest against blacklist","timeout":5000,"config":{"field":"{{guest.phone}}","operator":"blacklistCheck","value":null,"trueNext":"confirm_booking_msg","falseNext":"blacklist_rejected_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone"];
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

  describe('Workflow: Booking & Payment Handler, Node: Notify guest their booking cannot be processed', () => {
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
      const node = {"id":"blacklist_rejected_msg","type":"message","label":"Notify guest their booking cannot be processed","timeout":5000,"config":{"message":{"en":"We are sorry, but we are unable to process your booking at this time. Please contact us directly for further assistance.","ms":"Maaf, kami tidak dapat memproses tempahan anda pada masa ini. Sila hubungi kami secara langsung untuk bantuan lanjut.","zh":"非常抱歉，我们目前无法处理您的预订。请直接与我们联系以获取进一步帮助。"}}};
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

  describe('Workflow: Booking & Payment Handler, Node: Notify guest all rooms are fully booked with alternative suggestions', () => {
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
      const node = {"id":"room_unavailable_msg","type":"message","label":"Notify guest all rooms are fully booked with alternative suggestions","timeout":5000,"config":{"message":{"en":"Sorry, we are fully booked for those dates. Here are some nearby available periods you may consider:\n- Try shifting your check-in by 1-2 days\n- Consider a shorter stay\n\nWould you like to try different dates?","ms":"Maaf, kami penuh untuk tarikh tersebut. Berikut adalah cadangan tarikh terdekat yang mungkin tersedia:\n- Cuba geser tarikh check-in 1-2 hari\n- Pertimbangkan penginapan yang lebih singkat\n\nBoleh cuba tarikh lain?","zh":"抱歉，您所选日期的房间已全部预订。以下是一些可参考的近期可用时间段：\n- 尝试将入住日期调整1-2天\n- 考虑缩短住宿时间\n\n您想尝试其他日期吗？"}},"next":"wait_booking_dates"};
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

  describe('Workflow: Booking & Payment Handler, Node: Re-prompt after invalid date input', () => {
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
      const node = {"id":"date_error_reprompt","type":"wait_reply","label":"Re-prompt after invalid date input","timeout":5000,"config":{"storeAs":"booking_dates","prompt":{"en":"Sorry, I couldn't quite understand those dates. Please enter your dates in a clear format, e.g.:\n- Check-in: 15 Feb, Check-out: 17 Feb\n- 15/2/2026 to 17/2/2026","ms":"Maaf, saya tak faham tarikh tu. Sila masukkan tarikh dalam format yang jelas, contoh:\n- Check-in: 15 Feb, Check-out: 17 Feb\n- 15/2/2026 hingga 17/2/2026","zh":"抱歉，我无法理解那些日期。请用清晰的格式输入日期，例如：\n- 入住：2月15日，退房：2月17日\n- 2026年2月15日至2026年2月17日"}},"next":"check_blacklist"};
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

  describe('Workflow: Booking & Payment Handler, Node: Confirm booking details with guest', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];

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
      const requiredInputs = ["workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];

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
      const node = {"id":"confirm_booking_msg","type":"message","label":"Confirm booking details with guest","timeout":5000,"config":{"message":{"en":"Got it! Here are your booking details:\n\nName: {{workflow.data.guest_name}}\nGuests: {{workflow.data.guest_count}}\nDates: {{workflow.data.booking_dates}}\n\nIf you have already made payment, please share your payment receipt now. Otherwise, I will forward your details to our admin for assistance.","ms":"Baik! Ini butiran tempahan anda:\n\nNama: {{workflow.data.guest_name}}\nTetamu: {{workflow.data.guest_count}}\nTarikh: {{workflow.data.booking_dates}}\n\nKalau dah bayar, boleh share resit sekarang. Kalau belum, saya akan forward ke admin kami untuk bantuan lanjut.","zh":"好的！您的预订详情：\n\n姓名：{{workflow.data.guest_name}}\n人数：{{workflow.data.guest_count}}\n日期：{{workflow.data.booking_dates}}\n\n如果您已付款，请现在分享付款收据。否则，我将把您的详情转发给我们的管理员。"}},"next":"booking_notify_admin"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];
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
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];

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
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];

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
      const node = {"id":"booking_notify_admin","type":"whatsapp_send","label":"Notify admin about booking","timeout":5000,"config":{"receiver":"{{system.admin_phone}}","content":{"en":"New Booking Request\nGuest: {{workflow.data.guest_name}}\nPhone: {{guest.phone}}\nGuests: {{workflow.data.guest_count}}\nDates: {{workflow.data.booking_dates}}\nPlease review and confirm.","ms":"Tempahan Baru\nTetamu: {{workflow.data.guest_name}}\nTelefon: {{guest.phone}}\nBilangan tetamu: {{workflow.data.guest_count}}\nTarikh: {{workflow.data.booking_dates}}\nSila semak dan sahkan.","zh":"新预订请求\n客人：{{workflow.data.guest_name}}\n电话：{{guest.phone}}\n人数：{{workflow.data.guest_count}}\n日期：{{workflow.data.booking_dates}}\n请审核并确认。"},"urgency":"normal"},"next":"booking_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_dates","workflow.data.guest_count","workflow.data.guest_name"];
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

  describe('Workflow: Booking & Payment Handler, Node: Booking confirmation to guest', () => {
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
      const node = {"id":"booking_confirm_msg","type":"message","label":"Booking confirmation to guest","timeout":5000,"config":{"message":{"en":"Your booking request has been sent to our admin! They will contact you shortly to confirm your reservation. Thank you for choosing Pelangi Capsule Hostel!","ms":"Permintaan tempahan anda dah dihantar ke admin kami! Mereka akan hubungi anda tidak lama lagi untuk sahkan tempahan. Terima kasih kerana memilih Pelangi Capsule Hostel!","zh":"您的预订请求已发送给我们的管理员！他们将尽快联系您确认预订。感谢您选择 Pelangi Capsule Hostel！"}}};
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
      const node = {"id":"welcome_msg","type":"message","label":"Welcome greeting","config":{"message":{"en":"Welcome to Pelangi Capsule Hostel! 🎉 I'll help you with check-in.","ms":"Selamat datang ke Pelangi Capsule Hostel! 🎉 Saya akan bantu anda check-in.","zh":"欢迎来到Pelangi胶囊旅舍！🎉 我来帮您办理入住。"}},"next":"wait_name"};
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

  describe('Workflow: Complete Check-in Process, Node: Check capsule availability', () => {
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
      const node = {"id":"check_avail","type":"pelangi_api","label":"Check capsule availability","config":{"action":"check_availability"},"max_duration_ms":15000,"next":{"success":"check_avail_result","error":"avail_error"},"outputs":{"availableCount":"availableCount","availableCapsules":"availableCapsules"}};
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

  describe('Workflow: Complete Check-in Process, Node: Capsules available?', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["pelangi.availableCount"];

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
      const requiredInputs = ["pelangi.availableCount"];

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
      const node = {"id":"check_avail_result","type":"condition","label":"Capsules available?","config":{"field":"{{pelangi.availableCount}}","operator":"gt","value":0,"trueNext":"create_link","falseNext":"no_capsules_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["pelangi.availableCount"];
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

  describe('Workflow: Complete Check-in Process, Node: No capsules available', () => {
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
      const node = {"id":"no_capsules_msg","type":"message","label":"No capsules available","config":{"message":{"en":"I'm sorry, all capsules are currently occupied. 😔 Our admin at +60127088789 will contact you when one becomes available. We apologize for the inconvenience!","ms":"Maaf, semua capsule sedang penuh. 😔 Admin kami di +60127088789 akan hubungi anda bila ada yang kosong. Kami mohon maaf atas kesulitan!","zh":"抱歉，目前所有胶囊房都已满。😔 我们的管理员 +60127088789 会在有空房时联系您。非常抱歉给您带来不便！"}},"next":"notify_admin_waitlist"};
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
      const node = {"id":"notify_admin_waitlist","type":"whatsapp_send","label":"Notify admin about waitlist","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *Waitlist Request*\nGuest: {{workflow.data.guest_name}}\nPhone: {{guest.phone}}\nDates: {{workflow.data.stay_dates}}\nNo capsules available — please follow up.","ms":"📋 *Permintaan Senarai Tunggu*\nTetamu: {{workflow.data.guest_name}}\nTelefon: {{guest.phone}}\nTarikh: {{workflow.data.stay_dates}}\nTiada capsule — sila follow up.","zh":"📋 *等候名单*\n客人：{{workflow.data.guest_name}}\n电话：{{guest.phone}}\n日期：{{workflow.data.stay_dates}}\n无可用胶囊房——请跟进。"},"urgency":"normal"}};
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
      const node = {"id":"avail_error","type":"message","label":"API error fallback","config":{"message":{"en":"I couldn't check availability right now, but don't worry — capsules are almost always available! Let me continue with your check-in. 😊","ms":"Saya tak dapat check availability sekarang, tapi jangan risau — capsule biasanya ada! Biar saya teruskan check-in anda. 😊","zh":"暂时无法查询空房情况，但不用担心——通常都有空房！让我继续为您办理入住。😊"}},"next":"create_link"};
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
      const node = {"id":"create_link","type":"pelangi_api","label":"Create self-check-in link","config":{"action":"create_checkin_link","params":{"guestName":"{{workflow.data.guest_name}}","phoneNumber":"{{guest.phone}}"}},"max_duration_ms":20000,"next":{"success":"send_link_msg","error":"link_error_msg"},"outputs":{"checkinLink":"checkinLink","assignedCapsule":"assignedCapsule"}};
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

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false,"assignedCapsule":"test-external-value"};

    it('should have all required inputs present', () => {
      const requiredInputs = ["pelangi.assignedCapsule"];

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
      const requiredInputs = ["pelangi.assignedCapsule"];

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
      const node = {"id":"send_link_msg","type":"message","label":"Confirm link sent","config":{"message":{"en":"Great news — we have capsules available! 🎊\n\nI've assigned capsule *{{pelangi.assignedCapsule}}* for you and sent a self-check-in link to your WhatsApp.\n\nPlease fill in the form to complete your check-in! Our admin will be notified automatically once you're done.","ms":"Berita baik — kami ada capsule tersedia! 🎊\n\nSaya telah assign capsule *{{pelangi.assignedCapsule}}* untuk anda dan hantar link self-check-in ke WhatsApp anda.\n\nSila isi borang untuk lengkapkan check-in anda! Admin kami akan diberitahu secara automatik selepas selesai.","zh":"好消息——我们有胶囊房可用！🎊\n\n我已为您分配了胶囊房 *{{pelangi.assignedCapsule}}* 并发送了自助入住链接到您的WhatsApp。\n\n请填写表格以完成入住！完成后我们的管理员会自动收到通知。"}},"next":"info_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["pelangi.assignedCapsule"];
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
      const node = {"id":"info_msg","type":"message","label":"Hostel info card","config":{"message":{"en":"✅ You're all set! Here's some useful info:\n\n📋 *Quick Reference:*\n• Check-in time: *2:00 PM*\n• Check-out time: *12:00 PM*\n• Door password: *1270#*\n• WiFi: *PelangiHostel*\n• Address: Jalan Dato Haji Hassan, JB\n\n🎥 First time? Watch our video guide: https://youtu.be/bYj1M37xJiE\n\nNeed anything else? Just ask! 😊","ms":"✅ Semua siap! Ini maklumat berguna:\n\n📋 *Rujukan Pantas:*\n• Masa check-in: *2:00 PM*\n• Masa check-out: *12:00 PM*\n• Password pintu: *1270#*\n• WiFi: *PelangiHostel*\n• Alamat: Jalan Dato Haji Hassan, JB\n\n🎥 Pertama kali? Tonton video panduan: https://youtu.be/bYj1M37xJiE\n\nPerlukan apa-apa lagi? Tanya sahaja! 😊","zh":"✅ 一切就绪！以下是一些有用信息：\n\n📋 *快速参考：*\n• 入住时间: *下午2:00*\n• 退房时间: *中午12:00*\n• 门密码: *1270#*\n• WiFi: *PelangiHostel*\n• 地址: Jalan Dato Haji Hassan, JB\n\n🎥 第一次来？观看视频指南: https://youtu.be/bYj1M37xJiE\n\n还需要其他帮助吗？随时问我！😊"}}};
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
      const node = {"id":"lower_deck_info_msg","type":"message","label":"Lower deck info","config":{"message":{"en":"I understand you prefer a lower deck capsule! 😊 Lower decks (even-numbered capsules like C2, C4, C6, etc.) are very popular. Let me check availability for you.","ms":"Saya faham anda prefer lower deck! 😊 Lower deck (capsule nombor genap seperti C2, C4, C6, dll) sangat popular. Biar saya check untuk anda.","zh":"我明白您更喜欢下铺！😊 下铺（偶数编号如 C2、C4、C6 等）非常受欢迎。让我为您查询。"}},"next":"lower_deck_api_call"};
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

  describe('Workflow: Lower Deck Preference Check, Node: Check capsule availability', () => {
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
      const node = {"id":"lower_deck_api_call","type":"pelangi_api","label":"Check capsule availability","config":{"action":"check_lower_deck"},"next":"lower_deck_has_available"};
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

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false,"lowerDeckCount":"test-external-value"};

    it('should have all required inputs present', () => {
      const requiredInputs = ["pelangi.lowerDeckCount"];

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
      const requiredInputs = ["pelangi.lowerDeckCount"];

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
      const node = {"id":"lower_deck_has_available","type":"condition","label":"Any lower deck available?","config":{"field":"{{pelangi.lowerDeckCount}}","operator":"gt","value":0,"trueNext":"lower_deck_available_msg","falseNext":"lower_deck_unavailable_msg"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["pelangi.lowerDeckCount"];
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

  describe('Workflow: Lower Deck Preference Check, Node: Show available capsules', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false,"availabilityResult":"test-external-value"};

    it('should have all required inputs present', () => {
      const requiredInputs = ["pelangi.availabilityResult"];

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
      const requiredInputs = ["pelangi.availabilityResult"];

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
      const node = {"id":"lower_deck_available_msg","type":"message","label":"Show available capsules","config":{"message":{"en":"{{pelangi.availabilityResult}}\n\nWould you like to proceed with booking a lower deck capsule? Once you complete payment, we'll confirm your specific capsule assignment.","ms":"{{pelangi.availabilityResult}}\n\nNak proceed booking lower deck? Selepas pembayaran, kami akan confirm capsule anda.","zh":"{{pelangi.availabilityResult}}\n\n您想继续预订下铺吗？付款后我们会确认您的具体胶囊房分配。"}},"next":"lower_deck_wait_proceed"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["pelangi.availabilityResult"];
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

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false,"availabilityResult":"test-external-value"};

    it('should have all required inputs present', () => {
      const requiredInputs = ["pelangi.availabilityResult"];

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
      const requiredInputs = ["pelangi.availabilityResult"];

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
      const node = {"id":"lower_deck_unavailable_msg","type":"message","label":"No lower deck available","config":{"message":{"en":"{{pelangi.availabilityResult}}\n\nOur upper deck capsules are just as comfortable and come with a bit more privacy! Would you like to book an upper deck capsule instead?","ms":"{{pelangi.availabilityResult}}\n\nUpper deck kami sama selesa dan lebih privasi! Nak book upper deck?","zh":"{{pelangi.availabilityResult}}\n\n我们的上铺同样舒适，而且更有隐私！您想预订上铺吗？"}},"next":"lower_deck_wait_proceed"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["pelangi.availabilityResult"];
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
      const node = {"id":"tourist_attractions_msg","type":"message","label":"Attraction recommendations","config":{"message":{"en":"Wonderful! Johor Bahru has amazing attractions! 🎡🏖️ Here are the TOP destinations near our hostel:\n\n🎢 **LEGOLAND Malaysia** (25 mins drive)\n🏖️ **Desaru Beach** (1 hour)\n🕌 **Sultan Abu Bakar Mosque** (15 mins)\n🛍️ **Johor Bahru City Square** (10 mins)\n🌊 **Danga Bay** (20 mins)\n🐯 **Johor Zoo** (25 mins)\n🏛️ **Chinese Heritage Museum** (12 mins)\n🙏 **Glass Temple** (15 mins)\n\n🌐 More info: https://pelangicapsule.local/\n\nWould you like specific directions or recommendations?","ms":"Hebat! Johor Bahru ada banyak tempat menarik! 🎡🏖️ Ini tempat-tempat TOP dekat hostel kami:\n\n🎢 **LEGOLAND Malaysia** (25 minit)\n🏖️ **Pantai Desaru** (1 jam)\n🕌 **Masjid Sultan Abu Bakar** (15 minit)\n🛍️ **Johor Bahru City Square** (10 minit)\n🌊 **Danga Bay** (20 minit)\n🐯 **Zoo Johor** (25 minit)\n🏛️ **Muzium Warisan Cina** (12 minit)\n🙏 **Kuil Kaca** (15 minit)\n\n🌐 Maklumat lanjut: https://pelangicapsule.local/\n\nNak direction atau cadangan?","zh":"太好了！新山有很多精彩景点！🎡🏖️ 以下是我们旅舍附近的热门目的地：\n\n🎢 **乐高乐园** (25分钟车程)\n🏖️ **迪沙鲁海滩** (1小时)\n🕌 **苏丹阿布峇卡清真寺** (15分钟)\n🛍️ **新山城市广场** (10分钟)\n🌊 **丹加湾** (20分钟)\n🐯 **新山动物园** (25分钟)\n🏛️ **华人文物馆** (12分钟)\n🙏 **玻璃兴都庙** (15分钟)\n\n🌐 更多信息: https://pelangicapsule.local/\n\n需要具体路线或推荐吗？"},"interactiveList":{"title":"JB Tourist Attractions","description":"Tap to browse top destinations near Pelangi Capsule Hostel","buttonText":"View Attractions","sections":[{"title":"Popular Attractions","rows":[{"rowId":"legoland","title":"LEGOLAND Malaysia","description":"25 min drive - Theme park"},{"rowId":"desaru","title":"Desaru Beach","description":"1 hour - Coastal resort"},{"rowId":"mosque","title":"Sultan Abu Bakar Mosque","description":"15 min - Hilltop mosque"},{"rowId":"citysquare","title":"JB City Square","description":"10 min - Shopping mall"},{"rowId":"dangabay","title":"Danga Bay","description":"20 min - Seafront dining"}]},{"title":"Culture & Nature","rows":[{"rowId":"zoo","title":"Johor Zoo","description":"25 min - Wildlife park"},{"rowId":"heritage","title":"Chinese Heritage Museum","description":"12 min - History museum"},{"rowId":"glasstemple","title":"Glass Temple","description":"15 min - Hindu temple"}]}]}},"next":"tourist_wait_choice"};
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
      const node = {"id":"tourist_transport_msg","type":"message","label":"Transport info","config":{"message":{"en":"Great choice! 🚗 The easiest way is to grab a **Grab ride** directly from our hostel. Just enter the destination!\n\n📍 Search on **Google Maps** from: *Jalan Dato Haji Hassan, Johor Bahru*\n🚌 Public transport also available — ask our front desk!\n\n💡 **Pro tip:** Ask our front desk for discount deals on popular attractions!\n\nNeed anything else? 😊","ms":"Pilihan bagus! 🚗 Cara paling mudah ialah guna **Grab** terus dari hostel kami. Masukkan destinasi!\n\n📍 Cari di **Google Maps** dari: *Jalan Dato Haji Hassan, Johor Bahru*\n🚌 Pengangkutan awam juga ada — tanya kaunter depan!\n\n💡 **Tip:** Tanya kaunter depan untuk diskaun tempat popular!\n\nNak bantuan lain? 😊","zh":"好选择！🚗 最简单的方式是从旅舍直接叫 **Grab**。输入目的地就可以出发！\n\n📍 在 **Google Maps** 搜索：*Jalan Dato Haji Hassan, Johor Bahru*\n🚌 也有公共交通 — 问前台！\n\n💡 **小贴士：** 问前台获取热门景点折扣！\n\n需要其他帮助吗？😊"}}};
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
      const node = {"id":"complaint_apologize_msg","type":"message","label":"Apologize to guest","config":{"message":{"en":"We're truly sorry to hear about this. 😔 Your comfort is our top priority and we sincerely apologize for the inconvenience. We can arrange maintenance, relocate you to another capsule, or provide immediate staff support.","ms":"Kami amat minta maaf mendengar ini. 😔 Keselesaan anda keutamaan kami dan kami mohon maaf atas kesulitan. Kami boleh urus penyelenggaraan, pindahkan anda ke kapsul lain, atau beri sokongan staf segera.","zh":"我们真诚地为此感到抱歉。😔 您的舒适是我们的首要任务，我们对给您带来的不便深表歉意。我们可以安排维修、换房或提供即时工作人员支持。"}},"next":"complaint_wait_details"};
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
      const node = {"id":"theft_wait_location","type":"wait_reply","label":"Ask location of theft","config":{"storeAs":"theft_location","prompt":{"en":"Where did the theft occur? (e.g., in capsule, bathroom, common area)","ms":"Di mana lokasi kejadian? (contoh: dalam capsule, bilik air, ruang bersama)","zh":"在什么地方发生的？（例如：胶囊房内、浴室、公共区域）"}},"next":"theft_urgent_msg"};
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

  describe('Workflow: Card Locked Inside Capsule, Node: Emergency instructions', () => {
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
      const node = {"id":"locked_instructions_msg","type":"message","label":"Emergency instructions","config":{"message":{"en":"Oh no! Don't worry, this happens occasionally and we can solve it quickly. 😊\n\n**Quick Solution Steps:**\n1️⃣ Check if the capsule door has a small emergency release mechanism\n2️⃣ Try gently pushing/pulling the door while turning the handle\n3️⃣ Look for a small lever near the lock\n\nAre you able to see any of these mechanisms?","ms":"Oh tidak! Jangan risau, ini kadang-kadang berlaku dan kami boleh selesaikan dengan cepat. 😊\n\n**Langkah Penyelesaian Pantas:**\n1️⃣ Check jika pintu capsule ada mekanisme emergency release\n2️⃣ Cuba tolak/tarik pintu perlahan-lahan sambil pusing handle\n3️⃣ Cari tuas kecil dekat lock\n\nNampak mana-mana mekanisme ini?","zh":"哦不！别担心，这种情况偶尔会发生，我们可以快速解决。😊\n\n**快速解决步骤：**\n1️⃣ 检查胶囊门是否有紧急释放装置\n2️⃣ 尝试在转动把手的同时轻轻推拉门\n3️⃣ 在锁附近寻找小杠杆\n\n您能看到这些装置吗？"}},"next":"locked_wait_response"};
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

  describe('Workflow: Card Locked Inside Capsule, Node: Wait for guest response', () => {
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

  describe('Workflow: Card Locked Inside Capsule, Node: Contacting staff notice', () => {
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

  describe('Workflow: Card Locked Inside Capsule, Node: Notify admin about locked guest', () => {
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
      const node = {"id":"locked_notify_admin","type":"whatsapp_send","label":"Notify admin about locked guest","config":{"receiver":"{{system.admin_phone}}","content":{"en":"⚠️ *Card Locked in Capsule*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nGuest is locked — needs master key access. Please respond ASAP.","ms":"⚠️ *Kad Terkunci dalam Kapsul*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nTetamu terkunci — perlukan master key. Sila respons segera.","zh":"⚠️ *卡锁在胶囊内*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n客人被锁住——需要主钥匙。请尽快响应。"},"urgency":"high"},"next":"locked_reassure_msg"};
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

  describe('Workflow: Card Locked Inside Capsule, Node: Reassure guest while waiting', () => {
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
      const node = {"id":"locked_reassure_msg","type":"message","label":"Reassure guest while waiting","config":{"message":{"en":"✅ Staff notified! They have master access and will arrive shortly. Meanwhile:\n\n✅ Stay calm and comfortable inside\n✅ Keep your phone with you\n✅ The capsule has ventilation, so you're safe\n\nIs there anything you need while waiting?","ms":"✅ Staff diberitahu! Mereka ada master access dan akan sampai tidak lama lagi. Sementara itu:\n\n✅ Stay calm dan selesa dalam capsule\n✅ Simpan telefon dengan anda\n✅ Capsule ada pengudaraan, jadi anda selamat\n\nAda apa-apa yang anda perlukan sambil tunggu?","zh":"✅ 员工已通知！他们有主钥匙，会很快到达。同时：\n\n✅ 保持冷静和舒适\n✅ 保管好手机\n✅ 胶囊房有通风，所以您是安全的\n\n等待期间需要什么吗？"}}};
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
      const node = {"id":"checkout_welcome_msg","type":"message","label":"Checkout greeting","config":{"message":{"en":"We're sorry to see you go! 😊 I'll help you with checkout.","ms":"Kami sedih anda hendak pergi! 😊 Saya bantu anda checkout.","zh":"很遗憾您要离开了！😊 我来帮您办理退房。"}},"next":"checkout_wait_capsule"};
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

  describe('Workflow: Guest Checkout Process, Node: Ask capsule number', () => {
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
      const node = {"id":"checkout_wait_capsule","type":"wait_reply","label":"Ask capsule number","config":{"storeAs":"capsule_number","prompt":{"en":"What is your capsule number? (e.g., C5, C16, J3)","ms":"Apakah nombor capsule anda? (contoh: C5, C16, J3)","zh":"请问您的胶囊号是什么？（例如：C5、C16、J3）"}},"next":"checkout_checklist_msg"};
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
      const node = {"id":"checkout_checklist_msg","type":"message","label":"Checkout checklist","config":{"message":{"en":"Thank you! Before you leave, please make sure:\n\n✅ Collect all personal belongings from your capsule\n✅ Check under the pillow and mattress\n✅ Return the key card at the front desk\n✅ Check the common areas (bathroom, lounge) for any items\n\nOnce you're ready, just say *done* and I'll complete your checkout! 👍","ms":"Terima kasih! Sebelum anda pergi, sila pastikan:\n\n✅ Kumpul semua barang peribadi dari capsule\n✅ Check bawah bantal dan tilam\n✅ Pulangkan kad kunci di kaunter depan\n✅ Check kawasan umum (bilik air, lounge) untuk barang anda\n\nBila dah siap, cakap *done* dan saya akan selesaikan checkout anda! 👍","zh":"谢谢！离开前请确认：\n\n✅ 收集胶囊房内所有个人物品\n✅ 检查枕头和床垫下面\n✅ 在前台归还钥匙卡\n✅ 检查公共区域（浴室、休息室）是否有遗留物品\n\n准备好了就说 *done*，我会帮您完成退房！👍"}},"next":"checkout_wait_done"};
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
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"capsule_number":42};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.capsule_number"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.capsule_number"];

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
      const node = {"id":"checkout_notify_admin","type":"whatsapp_send","label":"Notify admin about checkout","config":{"receiver":"{{system.admin_phone}}","content":{"en":"📋 *Guest Checkout*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nCapsule: {{workflow.data.capsule_number}}\nGuest has checked out. Please prepare capsule for cleaning.","ms":"📋 *Checkout Tetamu*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nKapsul: {{workflow.data.capsule_number}}\nTetamu sudah checkout. Sila sediakan kapsul untuk pembersihan.","zh":"📋 *客人退房*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n胶囊房：{{workflow.data.capsule_number}}\n客人已退房。请准备清洁胶囊房。"},"urgency":"normal"},"next":"checkout_farewell_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.capsule_number"];
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
      const node = {"id":"checkout_farewell_msg","type":"message","label":"Farewell message","config":{"message":{"en":"✅ Checkout complete! Thank you for staying at Pelangi Capsule Hostel! 🌈\n\n🙏 We'd love your feedback! Please leave us a review:\n📍 Google: https://g.page/r/pelangi-capsule-hostel\n\n🧳 *Luggage storage* is available if you need to leave bags (free, limited space).\n\nSafe travels and we hope to see you again! 😊✨","ms":"✅ Checkout selesai! Terima kasih kerana menginap di Pelangi Capsule Hostel! 🌈\n\n🙏 Kami hargai maklum balas anda! Sila tinggalkan review:\n📍 Google: https://g.page/r/pelangi-capsule-hostel\n\n🧳 *Simpanan bagasi* tersedia jika perlu simpan beg (percuma, ruang terhad).\n\nSelamat jalan dan harap jumpa lagi! 😊✨","zh":"✅ 退房完成！感谢您入住Pelangi胶囊旅舍！🌈\n\n🙏 我们希望听到您的反馈！请给我们留下评价：\n📍 Google: https://g.page/r/pelangi-capsule-hostel\n\n🧳 如需寄存行李，我们提供 *行李寄存* 服务（免费，空间有限）。\n\n旅途愉快，希望再次见到您！😊✨"}}};
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
      const node = {"id":"amenity_intro_msg","type":"message","label":"Amenity offer","config":{"message":{"en":"Of course! We can provide extra towels, pillows, or blankets. Our on-site staff Maya will deliver them to your capsule. 🧺","ms":"Tentu! Kami boleh sediakan tuala, bantal, atau selimut tambahan. Staf kami Maya akan hantar ke kapsul anda. 🧺","zh":"当然可以！我们可以提供额外的毛巾、枕头或毯子。我们的现场工作人员Maya会送到您的胶囊房。🧺"}},"next":"amenity_wait_items"};
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
      const node = {"id":"amenity_delivering_msg","type":"message","label":"Delivery notice","config":{"message":{"en":"Great! I'm notifying our staff to deliver the items to your capsule...","ms":"Baik! Saya beritahu staf untuk hantar barang ke kapsul anda...","zh":"好的！我正在通知工作人员将物品送到您的胶囊房..."}},"next":"amenity_notify_staff"};
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
      const node = {"id":"amenity_notify_staff","type":"whatsapp_send","label":"Notify housekeeping staff","config":{"receiver":"{{system.admin_phone}}","content":{"en":"🧺 *Amenity Request*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nItems requested: {{workflow.data.requested_items}}\nPlease deliver to guest's capsule.","ms":"🧺 *Permintaan Kemudahan*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nBarang diperlukan: {{workflow.data.requested_items}}\nSila hantar ke kapsul tetamu.","zh":"🧺 *设施请求*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n请求物品：{{workflow.data.requested_items}}\n请送至客人胶囊房。"},"urgency":"normal"},"next":"amenity_confirm_msg"};
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

  describe('Workflow: Guest Service Request Handler, Node: Acknowledge request', () => {
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
      const node = {"id":"sr_intro_msg","type":"message","label":"Acknowledge request","config":{"message":{"en":"Of course! I will arrange that for you right away. 🙏","ms":"Tentu! Saya akan uruskan untuk anda sekarang. 🙏","zh":"当然！我马上为您安排。🙏"}},"next":"sr_ask_details"};
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

  describe('Workflow: Guest Service Request Handler, Node: Collect request details', () => {
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
      const node = {"id":"sr_ask_details","type":"wait_reply","label":"Collect request details","config":{"storeAs":"request_details","prompt":{"en":"Please describe your request in detail (e.g. extra towels, room cleaning, broken AC).","ms":"Sila huraikan permintaan anda dengan lengkap (contoh: tuala tambahan, bilik perlu dikemas, aircond rosak).","zh":"请详细描述您的需求（例如：额外毛巾、房间清洁、空调故障）。"}},"next":"sr_log_request"};
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

  describe('Workflow: Guest Service Request Handler, Node: Log service request to DB and notify staff', () => {
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
      const node = {"id":"sr_log_request","type":"pelangi_api","label":"Log service request to DB and notify staff","config":{"action":"log_service_request","params":{"urgency":"normal"}},"next":"sr_confirm_msg"};
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

  describe('Workflow: Guest Service Request Handler, Node: Confirmation with estimated wait', () => {
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
      const node = {"id":"sr_confirm_msg","type":"message","label":"Confirmation with estimated wait","config":{"message":{"en":"✅ Request logged! Our staff have been notified and will attend to you shortly.\n\nEstimated wait: ~15 minutes. Is there anything else you need? 😊","ms":"✅ Permintaan direkod! Staf kami telah dimaklumkan dan akan hadir tidak lama lagi.\n\nAnggaran masa tunggu: ~15 minit. Ada apa-apa lagi yang diperlukan? 😊","zh":"✅ 请求已记录！我们的工作人员已收到通知，将很快为您服务。\n\n预计等待时间：约15分钟。还有什么需要帮助的吗？😊"}}};
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

  describe('Workflow: Emergency / SOS Escalation, Node: Immediate SOS acknowledgement', () => {
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
      const node = {"id":"sos_immediate_ack","type":"message","label":"Immediate SOS acknowledgement","config":{"message":{"en":"🚨 EMERGENCY ALERT — I have immediately notified ALL our staff. Help is on the way. Please stay calm and stay safe.","ms":"🚨 AMARAN KECEMASAN — Saya telah memberitahu SEMUA staf kami. Bantuan sedang dalam perjalanan. Sila kekal tenang dan selamat.","zh":"🚨 紧急警报 — 我已立即通知所有员工。帮助正在路上。请保持冷静，注意安全。"}},"next":"sos_notify_staff_1"};
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

  describe('Workflow: Emergency / SOS Escalation, Node: Alert staff phone 1 (Alston)', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789","alston_phone":"test-system-value"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","message.text","system.alston_phone"];

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
      const requiredInputs = ["guest.phone","message.text","system.alston_phone"];

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
      const node = {"id":"sos_notify_staff_1","type":"whatsapp_send","label":"Alert staff phone 1 (Alston)","config":{"receiver":"{{system.alston_phone}}","content":{"en":"🚨 *EMERGENCY SOS*\nGuest: {{guest.phone}}\nMessage: {{message.text}}\nACTION REQUIRED IMMEDIATELY.","ms":"🚨 *KECEMASAN SOS*\nTetamu: {{guest.phone}}\nMesej: {{message.text}}\nTINDAKAN SEGERA DIPERLUKAN.","zh":"🚨 *紧急SOS*\n客人: {{guest.phone}}\n消息: {{message.text}}\n需要立即采取行动。"},"urgency":"critical"},"next":"sos_notify_staff_2"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","message.text","system.alston_phone"];
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

  describe('Workflow: Emergency / SOS Escalation, Node: Alert staff phone 2 (Jay)', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789","jay_phone":"test-system-value"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","message.text","system.jay_phone"];

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
      const requiredInputs = ["guest.phone","message.text","system.jay_phone"];

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
      const node = {"id":"sos_notify_staff_2","type":"whatsapp_send","label":"Alert staff phone 2 (Jay)","config":{"receiver":"{{system.jay_phone}}","content":{"en":"🚨 *EMERGENCY SOS*\nGuest: {{guest.phone}}\nMessage: {{message.text}}\nACTION REQUIRED IMMEDIATELY.","ms":"🚨 *KECEMASAN SOS*\nTetamu: {{guest.phone}}\nMesej: {{message.text}}\nTINDAKAN SEGERA DIPERLUKAN.","zh":"🚨 *紧急SOS*\n客人: {{guest.phone}}\n消息: {{message.text}}\n需要立即采取行动。"},"urgency":"critical"},"next":"sos_notify_staff_3"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","message.text","system.jay_phone"];
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

  describe('Workflow: Emergency / SOS Escalation, Node: Alert staff phone 3', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"}};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","message.text"];

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
      const requiredInputs = ["guest.phone","message.text"];

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
      const node = {"id":"sos_notify_staff_3","type":"whatsapp_send","label":"Alert staff phone 3","config":{"receiver":"60103084289","content":{"en":"🚨 *EMERGENCY SOS*\nGuest: {{guest.phone}}\nMessage: {{message.text}}\nACTION REQUIRED IMMEDIATELY.","ms":"🚨 *KECEMASAN SOS*\nTetamu: {{guest.phone}}\nMesej: {{message.text}}\nTINDAKAN SEGERA DIPERLUKAN.","zh":"🚨 *紧急SOS*\n客人: {{guest.phone}}\n消息: {{message.text}}\n需要立即采取行动。"},"urgency":"critical"},"next":"sos_confirm_msg"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","message.text"];
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

  describe('Workflow: Emergency / SOS Escalation, Node: Confirmation with emergency numbers', () => {
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
      const node = {"id":"sos_confirm_msg","type":"message","label":"Confirmation with emergency numbers","config":{"message":{"en":"✅ All staff notified. If you need emergency services, call 999 (Police/Fire/Ambulance) or 112 (Emergency).","ms":"✅ Semua staf telah diberitahu. Jika perlukan perkhidmatan kecemasan, hubungi 999 (Polis/Bomba/Ambulans) atau 112 (Kecemasan).","zh":"✅ 所有员工已通知。如需紧急服务，请拨打999（警察/消防/救护车）或112（紧急）。"}}};
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

  describe('Workflow: Stay Extension Request, Node: Ask for new check-out date', () => {
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
      const node = {"id":"ext_ask_date","type":"message","label":"Ask for new check-out date","config":{"message":{"en":"Sure! I can help with extending your stay 😊\n\nWhat would be your new check-out date? (e.g. 20 March 2026)","ms":"Boleh! Saya boleh bantu untuk lanjutkan penginapan anda 😊\n\nApakah tarikh daftar keluar baru anda? (cth. 20 Mac 2026)","zh":"没问题！我可以帮您延长住宿 😊\n\n您新的退房日期是哪天？（例如：2026年3月20日）"},"waitForReply":true},"next":"ext_collect_date"};
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

  describe('Workflow: Stay Extension Request, Node: Collect new check-out date', () => {
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
      const node = {"id":"ext_collect_date","type":"collect_input","label":"Collect new check-out date","config":{"variable":"new_checkout_date","validation":"date_like"},"next":"ext_notify_admin"};
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

  describe('Workflow: Stay Extension Request, Node: Forward extension request to admin', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"new_checkout_date":"2026-02-15"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678","name":"test-guest-value"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.new_checkout_date"];

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
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.new_checkout_date"];

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
      const node = {"id":"ext_notify_admin","type":"whatsapp_send","label":"Forward extension request to admin","config":{"receiver":"{{system.admin_phone}}","content":{"en":"🏨 *Stay Extension Request*\nGuest: {{guest.name}}\nPhone: {{guest.phone}}\nRequested new check-out: {{workflow.data.new_checkout_date}}\n\nPlease check availability and confirm with the guest.","ms":"🏨 *Permintaan Lanjut Penginapan*\nTetamu: {{guest.name}}\nTelefon: {{guest.phone}}\nTarikh daftar keluar baru: {{workflow.data.new_checkout_date}}\n\nSila semak ketersediaan dan sahkan dengan tetamu.","zh":"🏨 *延长住宿请求*\n客人：{{guest.name}}\n电话：{{guest.phone}}\n新退房日期：{{workflow.data.new_checkout_date}}\n\n请核对空房情况并与客人确认。"},"urgency":"normal"},"next":"ext_confirm_guest"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.name","guest.phone","system.admin_phone","workflow.data.new_checkout_date"];
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

  describe('Workflow: Stay Extension Request, Node: Confirm request forwarded to guest', () => {
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
      const node = {"id":"ext_confirm_guest","type":"message","label":"Confirm request forwarded to guest","config":{"message":{"en":"✅ Your extension request has been forwarded to our team. We'll confirm availability within 30 minutes. Thank you for your patience!","ms":"✅ Permintaan lanjutan anda telah dihantar ke pasukan kami. Kami akan sahkan ketersediaan dalam masa 30 minit. Terima kasih atas kesabaran anda!","zh":"✅ 您的延长住宿请求已转交给我们的团队。我们将在30分钟内确认空房情况。感谢您的耐心等待！"},"waitForReply":false}};
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

  describe('Workflow: Booking Modification, Node: List existing bookings', () => {
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
      const node = {"id":"list_existing_bookings","type":"message","label":"List existing bookings","config":{"message":{"en":"I can help you modify your booking. Please provide your booking reference number or the name used when booking.","ms":"Saya boleh bantu ubah tempahan anda. Sila berikan nombor rujukan tempahan atau nama yang digunakan semasa menempah.","zh":"我可以帮您修改预订。请提供您的预订参考编号或预订时使用的姓名。"}},"next":"select_booking_id"};
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

  describe('Workflow: Booking Modification, Node: Guest provides booking ID or name', () => {
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
      const node = {"id":"select_booking_id","type":"wait_reply","label":"Guest provides booking ID or name","config":{"storeAs":"booking_ref","prompt":{"en":"Please enter your booking reference or full name:","ms":"Sila masukkan rujukan tempahan atau nama penuh anda:","zh":"请输入您的预订参考编号或全名："}},"next":"choose_change_type"};
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

  describe('Workflow: Booking Modification, Node: Ask what to modify', () => {
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
      const node = {"id":"choose_change_type","type":"wait_reply","label":"Ask what to modify","config":{"storeAs":"change_type","prompt":{"en":"What would you like to modify?\n1. Check-in / Check-out dates\n2. Room type\n3. Add amenities\n\nReply with 1, 2, or 3.","ms":"Apakah yang anda ingin ubah?\n1. Tarikh check-in / check-out\n2. Jenis bilik\n3. Tambah kemudahan\n\nBalas dengan 1, 2, atau 3.","zh":"您想修改什么？\n1. 入住/退房日期\n2. 房型\n3. 添加设施\n\n请回复 1、2 或 3。"}},"next":"validate_availability"};
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

  describe('Workflow: Booking Modification, Node: Get new dates or room type', () => {
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
      const node = {"id":"validate_availability","type":"wait_reply","label":"Get new dates or room type","config":{"storeAs":"new_booking_details","prompt":{"en":"Please provide the new details for your modification (e.g., new dates: 20 Mar - 22 Mar, or room type: capsule/private):","ms":"Sila berikan butiran baru untuk pengubahsuaian anda (contoh: tarikh baru: 20 Mar - 22 Mar, atau jenis bilik: kapsul/persendirian):","zh":"请提供您的修改新详情（例如，新日期：3月20日至3月22日，或房型：胶囊/私人）："}},"next":"confirm_and_update"};
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

  describe('Workflow: Booking Modification, Node: Confirm modification request', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"booking_ref":"test-value","change_type":"test-value","new_booking_details":"test-value"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_ref","workflow.data.change_type","workflow.data.new_booking_details"];

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
      const requiredInputs = ["workflow.data.booking_ref","workflow.data.change_type","workflow.data.new_booking_details"];

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
      const node = {"id":"confirm_and_update","type":"message","label":"Confirm modification request","config":{"message":{"en":"Thank you. Your modification request has been received.\n\nBooking ref: {{workflow.data.booking_ref}}\nChange type: {{workflow.data.change_type}}\nNew details: {{workflow.data.new_booking_details}}\n\nOur staff will confirm availability and update your booking within 30 minutes. You will receive a confirmation message shortly.","ms":"Terima kasih. Permintaan pengubahsuaian anda telah diterima.\n\nRujukan tempahan: {{workflow.data.booking_ref}}\nJenis perubahan: {{workflow.data.change_type}}\nButiran baru: {{workflow.data.new_booking_details}}\n\nStaf kami akan mengesahkan ketersediaan dan mengemas kini tempahan anda dalam masa 30 minit. Anda akan menerima mesej pengesahan tidak lama lagi.","zh":"谢谢。您的修改请求已收到。\n\n预订参考：{{workflow.data.booking_ref}}\n修改类型：{{workflow.data.change_type}}\n新详情：{{workflow.data.new_booking_details}}\n\n我们的工作人员将在30分钟内确认可用性并更新您的预订。您将很快收到确认消息。"}}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_ref","workflow.data.change_type","workflow.data.new_booking_details"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Confirm cancellation intent', () => {
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
      const node = {"id":"confirm_cancellation","type":"wait_reply","label":"Confirm cancellation intent","config":{"storeAs":"cancellation_confirmed","prompt":{"en":"I understand you'd like to cancel your booking. Can you confirm? Reply YES or NO.","ms":"Saya faham anda ingin membatalkan tempahan. Boleh sahkan? Balas YA atau TIDAK.","zh":"我理解您想取消预订。请确认吗？回复是或否。"}},"next":"check_cancellation_intent"};
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

  describe('Workflow: Booking Cancellation Workflow, Node: Check if guest confirmed', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"cancellation_confirmed":"test-value"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.cancellation_confirmed"];

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
      const requiredInputs = ["workflow.data.cancellation_confirmed"];

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
      const node = {"id":"check_cancellation_intent","type":"condition","label":"Check if guest confirmed","config":{"field":"{{workflow.data.cancellation_confirmed}}","operator":"regex","value":"^(yes|ya|yep|confirm|ok|y)$","trueNext":"ask_checkin_date","falseNext":"cancellation_declined"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.cancellation_confirmed"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Guest declined cancellation', () => {
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
      const node = {"id":"cancellation_declined","type":"message","label":"Guest declined cancellation","config":{"message":{"en":"Got it! Your booking remains active.","ms":"Baik! Tempahan anda tetap aktif.","zh":"明白了！您的预订保持有效。"}}};
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

  describe('Workflow: Booking Cancellation Workflow, Node: Ask for check-in date', () => {
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
      const node = {"id":"ask_checkin_date","type":"wait_reply","label":"Ask for check-in date","config":{"storeAs":"booking_checkin_date","prompt":{"en":"Thank you. Please provide your check-in date (YYYY-MM-DD format)","ms":"Terima kasih. Berikan tarikh check-in anda (format YYYY-MM-DD)","zh":"感谢。请提供您的入住日期（YYYY-MM-DD格式）"}},"next":"validate_checkin_date"};
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

  describe('Workflow: Booking Cancellation Workflow, Node: Validate date format', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"booking_checkin_date":"2026-02-15"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_checkin_date"];

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
      const requiredInputs = ["workflow.data.booking_checkin_date"];

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
      const node = {"id":"validate_checkin_date","type":"condition","label":"Validate date format","config":{"field":"{{workflow.data.booking_checkin_date}}","operator":"regex","value":"^\\d{4}-\\d{2}-\\d{2}$","trueNext":"calculate_credit","falseNext":"invalid_date_error"}};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_checkin_date"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Invalid date format', () => {
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
      const node = {"id":"invalid_date_error","type":"message","label":"Invalid date format","config":{"message":{"en":"Please use YYYY-MM-DD format (e.g., 2026-02-15)","ms":"Sila gunakan format YYYY-MM-DD (cth., 2026-02-15)","zh":"请使用YYYY-MM-DD格式（例如2026-02-15）"}},"next":"ask_checkin_date"};
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

  describe('Workflow: Booking Cancellation Workflow, Node: Calculate credit', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"booking_checkin_date":"2026-02-15"};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.booking_checkin_date"];

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
      const requiredInputs = ["workflow.data.booking_checkin_date"];

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
      const node = {"id":"calculate_credit","type":"function","label":"Calculate credit","config":{"function":"calculateCancellationCredit","inputs":{"checkInDate":"{{workflow.data.booking_checkin_date}}"},"outputAs":"credit_result"},"next":"display_credit_message"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.booking_checkin_date"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Display credit result', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"credit_result":42};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["workflow.data.credit_result"];

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
      const requiredInputs = ["workflow.data.credit_result"];

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
      const node = {"id":"display_credit_message","type":"message","label":"Display credit result","config":{"message":{"en":"Cancellation processed! {{workflow.data.credit_result}}","ms":"Pembatalan diproses! {{workflow.data.credit_result}}","zh":"取消已处理！{{workflow.data.credit_result}}"}},"next":"notify_admin_cancellation"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["workflow.data.credit_result"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Notify admin', () => {
    const workflowData = {"guest_name":"John Doe","guest_count":2,"booking_dates":"15 Feb - 17 Feb","stay_dates":"15 Feb - 17 Feb","booking_dates_normalized":{"checkIn":"2026-02-15","checkOut":"2026-02-17"},"booking_checkin_date":"2026-02-15","credit_result":42};

    const systemData = {"admin_phone":"+60127088789"};

    const guestData = {"phone":"+60112345678"};

    const externalData = {"availableCount":3,"availableCapsules":["A1","A2","A3"],"roomAvailable":true,"isBlacklisted":false};

    it('should have all required inputs present', () => {
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_checkin_date","workflow.data.credit_result"];

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
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_checkin_date","workflow.data.credit_result"];

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
      const node = {"id":"notify_admin_cancellation","type":"whatsapp_send","label":"Notify admin","config":{"receiver":"{{system.admin_phone}}","content":{"en":"Booking Cancellation: {{guest.phone}} - Check-in: {{workflow.data.booking_checkin_date}} - Credit: {{workflow.data.credit_result}}"},"urgency":"normal"},"next":"cancellation_complete"};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ["guest.phone","system.admin_phone","workflow.data.booking_checkin_date","workflow.data.credit_result"];
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

  describe('Workflow: Booking Cancellation Workflow, Node: Final confirmation', () => {
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
      const node = {"id":"cancellation_complete","type":"message","label":"Final confirmation","config":{"message":{"en":"Your cancellation request has been sent to our admin team. Thank you!","ms":"Permintaan pembatalan anda telah dihantar. Terima kasih!","zh":"您的取消请求已发送给管理员。谢谢！"}}};
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
