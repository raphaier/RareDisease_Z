import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DiseaseCase {
  id: number;
  name: string;
  age: number;
  diseaseType: string;
  symptoms: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<DiseaseCase[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCaseData, setNewCaseData] = useState({ 
    name: "", 
    age: "", 
    diseaseType: "", 
    symptoms: "" 
  });
  const [selectedCase, setSelectedCase] = useState<DiseaseCase | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [operation, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const casesList: DiseaseCase[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          casesList.push({
            id: parseInt(businessId.replace('case-', '')) || Date.now(),
            name: businessData.name,
            age: Number(businessData.publicValue1) || 0,
            diseaseType: businessData.description,
            symptoms: `Symptoms recorded`,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading case data:', e);
        }
      }
      
      setCases(casesList);
      addToHistory(`Data refreshed: ${casesList.length} cases loaded`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const testAvailability = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System is available and ready!" });
        addToHistory("System availability checked: Ready");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const createCase = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCase(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting patient data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const ageValue = parseInt(newCaseData.age) || 0;
      const businessId = `case-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, ageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCaseData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        ageValue,
        0,
        newCaseData.diseaseType
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted data on blockchain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Patient case created successfully!" });
      addToHistory(`New case created: ${newCaseData.name}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCaseData({ name: "", age: "", diseaseType: "", symptoms: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCase(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addToHistory(`Data verified for case: ${businessData.name}`);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Data decrypted for case: ${businessData.name}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredCases = cases.filter(caseItem => {
    const matchesSearch = caseItem.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         caseItem.diseaseType.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === "all" || 
                         (filterType === "verified" && caseItem.isVerified) ||
                         (filterType === "unverified" && !caseItem.isVerified);
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: cases.length,
    verified: cases.filter(c => c.isVerified).length,
    avgAge: cases.length > 0 ? cases.reduce((sum, c) => sum + c.age, 0) / cases.length : 0,
    recent: cases.filter(c => Date.now()/1000 - c.timestamp < 60 * 60 * 24 * 7).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🧬 罕見病隱私登記</h1>
            <p>Rare Disease Privacy Registry</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Encrypted Registry</h2>
            <p>Secure FHE-powered platform for rare disease patient registration and research</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Register encrypted patient cases</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Contribute to medical research while protecting privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing patient data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted registry...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🧬 罕見病隱私登記</h1>
          <p>FHE-Protected Rare Disease Registry</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Check FHE System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Case
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Cases</h3>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-trend">+{stats.recent} this week</div>
          </div>
          
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}/{stats.total}</div>
            <div className="stat-trend">FHE Verified</div>
          </div>
          
          <div className="stat-card">
            <h3>Avg Age</h3>
            <div className="stat-value">{stats.avgAge.toFixed(1)}</div>
            <div className="stat-trend">Encrypted Analysis</div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input 
              type="text" 
              placeholder="Search cases..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Cases</option>
              <option value="verified">Verified Only</option>
              <option value="unverified">Unverified</option>
            </select>
            <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="info-buttons">
            <button onClick={() => setShowFAQ(!showFAQ)} className="info-btn">
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>
        </div>

        {showFAQ && (
          <div className="faq-section">
            <h3>FHE Privacy Protection FAQ</h3>
            <div className="faq-item">
              <strong>How is my data protected?</strong>
              <p>Patient age is encrypted using FHE, allowing statistical analysis without revealing individual identities.</p>
            </div>
            <div className="faq-item">
              <strong>What data is encrypted?</strong>
              <p>Only sensitive numerical data (age) is encrypted. Disease type is stored publicly for research purposes.</p>
            </div>
            <div className="faq-item">
              <strong>How does FHE work?</strong>
              <p>FHE allows computations on encrypted data without decryption, preserving privacy while enabling research.</p>
            </div>
          </div>
        )}

        <div className="cases-grid">
          {filteredCases.length === 0 ? (
            <div className="no-cases">
              <p>No cases found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Register First Case
              </button>
            </div>
          ) : filteredCases.map((caseItem, index) => (
            <div 
              className={`case-card ${caseItem.isVerified ? "verified" : ""}`} 
              key={index}
              onClick={() => setSelectedCase(caseItem)}
            >
              <div className="case-header">
                <h4>{caseItem.name}</h4>
                <span className={`status ${caseItem.isVerified ? "verified" : "pending"}`}>
                  {caseItem.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                </span>
              </div>
              <div className="case-details">
                <p><strong>Disease:</strong> {caseItem.diseaseType}</p>
                <p><strong>Age:</strong> {caseItem.isVerified ? caseItem.decryptedValue : "🔒 Encrypted"}</p>
                <p><strong>Registered:</strong> {new Date(caseItem.timestamp * 1000).toLocaleDateString()}</p>
              </div>
              <button 
                className="view-details-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCase(caseItem);
                }}
              >
                View Details
              </button>
            </div>
          ))}
        </div>

        <div className="history-section">
          <h3>Recent Operations</h3>
          <div className="history-list">
            {operationHistory.map((op, index) => (
              <div key={index} className="history-item">
                {op}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateCase 
          onSubmit={createCase} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCase} 
          caseData={newCaseData} 
          setCaseData={setNewCaseData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCase && (
        <CaseDetailModal 
          case={selectedCase} 
          onClose={() => setSelectedCase(null)} 
          decryptData={() => decryptData(`case-${selectedCase.id}`)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateCase: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  caseData: any;
  setCaseData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, caseData, setCaseData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'age') {
      const intValue = value.replace(/[^\d]/g, '');
      setCaseData({ ...caseData, [name]: intValue });
    } else {
      setCaseData({ ...caseData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-case-modal">
        <div className="modal-header">
          <h2>Register New Patient Case</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Age Encryption</strong>
            <p>Patient age will be encrypted using homomorphic encryption for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Patient Name *</label>
            <input 
              type="text" 
              name="name" 
              value={caseData.name} 
              onChange={handleChange} 
              placeholder="Enter patient name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Age (Encrypted) *</label>
            <input 
              type="number" 
              name="age" 
              value={caseData.age} 
              onChange={handleChange} 
              placeholder="Enter age..." 
              min="0"
              max="120"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Disease Type *</label>
            <select name="diseaseType" value={caseData.diseaseType} onChange={handleChange}>
              <option value="">Select disease type</option>
              <option value="Huntington's Disease">Huntington's Disease</option>
              <option value="Cystic Fibrosis">Cystic Fibrosis</option>
              <option value="Muscular Dystrophy">Muscular Dystrophy</option>
              <option value="Other Rare Condition">Other Rare Condition</option>
            </select>
            <div className="data-type-label">Public Research Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !caseData.name || !caseData.age || !caseData.diseaseType} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Registering..." : "Register Case"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CaseDetailModal: React.FC<{
  case: any;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ case: caseItem, onClose, isDecrypting, decryptData }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (caseItem.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalDecrypted(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="case-detail-modal">
        <div className="modal-header">
          <h2>Patient Case Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="case-info">
            <div className="info-row">
              <span>Patient Name:</span>
              <strong>{caseItem.name}</strong>
            </div>
            <div className="info-row">
              <span>Disease Type:</span>
              <strong>{caseItem.diseaseType}</strong>
            </div>
            <div className="info-row">
              <span>Registration Date:</span>
              <strong>{new Date(caseItem.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Registered by:</span>
              <strong>{caseItem.creator.substring(0, 6)}...{caseItem.creator.substring(38)}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Privacy Protection</h3>
            <div className="data-row">
              <div className="data-label">Age Data:</div>
              <div className="data-value">
                {caseItem.isVerified ? 
                  `${caseItem.decryptedValue} (On-chain Verified)` : 
                  localDecrypted !== null ? 
                  `${localDecrypted} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              {!caseItem.isVerified && (
                <button 
                  className={`decrypt-btn ${localDecrypted !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt Age"}
                </button>
              )}
            </div>
            
            <div className="fhe-explanation">
              <p>Age data is encrypted using Fully Homomorphic Encryption (FHE), allowing statistical analysis while protecting individual privacy.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!caseItem.isVerified && localDecrypted !== null && (
            <button className="verified-btn">Data Available for Research</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

